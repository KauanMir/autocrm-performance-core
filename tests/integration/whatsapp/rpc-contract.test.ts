// tests/integration/whatsapp/rpc-contract.test.ts — contrato entre os adaptadores
// TypeScript e as funções SQL. Lê as migrations e confere nomes de parâmetros e
// colunas de saída, como complemento aos tipos gerados: pega nomes em mocks e casts,
// que o TypeScript não vê. Sem banco e sem rede.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import {
  captureInboundMessage,
  fetchWhatsAppDiagnosticsSummary,
  loadWhatsAppCaptureContext,
  markInboundEventFailed,
} from '@/lib/server/whatsapp-webhook/capture-rpc';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const allSql = readdirSync(MIGRATIONS)
  .filter((file) => file.includes('whatsapp'))
  .sort()
  .map((file) => readFileSync(resolve(MIGRATIONS, file), 'utf8'))
  .join('\n');

function sqlFunction(name: string): { parameters: string[]; returns: string[] } {
  const match = new RegExp(
    `create (?:or replace )?function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns (table \\(([\\s\\S]*?)\\)|\\w+)`,
  ).exec(allSql);
  if (!match) throw new Error(`função não encontrada: ${name}`);
  const names = (list: string) =>
    list
      .split(',')
      .map((item) => item.trim().split(/\s+/)[0])
      .filter(Boolean);
  return { parameters: names(match[1]), returns: match[3] ? names(match[3]) : [] };
}

const lastArgs = () => Object.keys(mocks.rpc.mock.calls[0][1] as Record<string, unknown>).sort();
const calledName = () => mocks.rpc.mock.calls[0][0] as string;

const NOW = new Date('2026-11-05T10:00:00.000Z');

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

describe('parâmetros enviados batem com a assinatura SQL', () => {
  it('whatsapp_connection_capture_context', async () => {
    await loadWhatsAppCaptureContext('123');
    expect(calledName()).toBe('whatsapp_connection_capture_context');
    expect(lastArgs()).toEqual(sqlFunction(calledName()).parameters.sort());
  });

  it('whatsapp_inbound_message_capture', async () => {
    await captureInboundMessage({
      connectionId: 'c', companyId: 'e', phoneNumberId: '1', wabaId: '2', messageIdHash: 'h', messageType: 'text',
      occurredAt: NOW, receivedAt: NOW, requestId: 'r', bsuidHmac: null, phoneHmac: 'p', piiCiphertext: 'x', piiRef: 'y',
      piiHasPhone: true, contentCiphertext: 'z', keyVersion: 1,
    });
    expect(calledName()).toBe('whatsapp_inbound_message_capture');
    expect(lastArgs()).toEqual(sqlFunction(calledName()).parameters.sort());
  });

  it('whatsapp_inbound_event_mark_failed', async () => {
    await markInboundEventFailed({
      connectionId: 'c', companyId: 'e', phoneNumberId: '1', wabaId: '2', messageIdHash: 'h', messageType: 'text',
      errorCode: 'group_message', occurredAt: null, receivedAt: NOW, requestId: 'r',
    });
    expect(calledName()).toBe('whatsapp_inbound_event_mark_failed');
    expect(lastArgs()).toEqual(sqlFunction(calledName()).parameters.sort());
  });

  it('whatsapp_diagnostics_summary', async () => {
    await fetchWhatsAppDiagnosticsSummary('e');
    expect(calledName()).toBe('whatsapp_diagnostics_summary');
    expect(lastArgs()).toEqual(sqlFunction(calledName()).parameters.sort());
  });
});

describe('colunas lidas existem na saída SQL', () => {
  const source = readFileSync(resolve(process.cwd(), 'lib/server/whatsapp-webhook/capture-rpc.ts'), 'utf8');
  const declared = [
    ...sqlFunction('whatsapp_connection_capture_context').returns,
    ...sqlFunction('whatsapp_inbound_message_capture').returns,
    ...sqlFunction('whatsapp_inbound_event_mark_failed').returns,
    ...sqlFunction('whatsapp_diagnostics_summary').returns,
  ];

  it('toda coluna out_ usada no adaptador é devolvida por alguma RPC', () => {
    const used = [...new Set(source.match(/\bout_[a-z_]+/g) ?? [])];
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((column) => !declared.includes(column))).toEqual([]);
  });

  it('códigos de recusa do TypeScript são aceitos pela RPC', () => {
    const accepted = /p_error_code not in \(([^)]*)\)/.exec(allSql)?.[1] ?? '';
    const typed = /InboundEventFailureCode =([^;]*);/.exec(source)?.[1] ?? '';
    const values = [...typed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(values.length).toBe(3);
    for (const value of values) expect(accepted).toContain(`'${value}'`);
  });

  it('resultados da captura do TypeScript existem na RPC', () => {
    const outcomes = /CAPTURE_OUTCOMES: readonly string\[\] = \[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
    const values = [...outcomes.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(values.length).toBe(6);
    for (const value of values) expect(allSql).toContain(`'${value}'`);
  });
});

describe('segurança operacional das migrations W2B-4', () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('_w2b4.sql'));
  const read = (file: string) => readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const code = (file: string) => read(file).replace(/^\s*--.*$/gm, '');

  it('são duas, posteriores à última migration W2A', () => {
    expect(files.sort()).toEqual([
      '20261105100000_whatsapp_conversations_w2b4.sql',
      '20261105110000_whatsapp_capture_rpcs_w2b4.sql',
    ]);
    const all = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
    expect(all.slice(-2)).toEqual(files);
  });

  it.each(['20261105100000_whatsapp_conversations_w2b4.sql', '20261105110000_whatsapp_capture_rpcs_w2b4.sql'])(
    '%s define lock_timeout no início e restaura no fim',
    (file) => {
      const sql = code(file).trim();
      expect(sql.startsWith("set lock_timeout = '5s';")).toBe(true);
      expect(sql.endsWith('reset lock_timeout;')).toBe(true);
    },
  );

  it('não referenciam tabelas de leads', () => {
    for (const file of files) expect(code(file)).not.toMatch(/public\.leads|lead_id/);
  });

  it('não apagam nem reescrevem dados existentes', () => {
    for (const file of files) {
      expect(code(file)).not.toMatch(/\b(truncate|drop table|drop column|alter column|delete from public\.(companies|leads|profiles))\b/i);
    }
  });

  it('só alteram as tabelas WhatsApp existentes', () => {
    const altered = [...code(files[0]).matchAll(/alter table public\.([a-z_]+)/g)].map((match) => match[1]);
    expect([...new Set(altered)].sort()).toEqual([
      'whatsapp_connections', 'whatsapp_contacts', 'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
    ]);
  });

  it('toda função nova tem SECURITY DEFINER e search_path vazio', () => {
    const sql = code('20261105110000_whatsapp_capture_rpcs_w2b4.sql');
    const created = sql.split(/create function /).slice(1);
    expect(created.length).toBe(6);
    for (const body of created) {
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
    }
  });
});
