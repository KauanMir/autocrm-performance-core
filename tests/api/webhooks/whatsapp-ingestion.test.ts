// tests/api/webhooks/whatsapp-ingestion.test.ts — W2A: rota real + ingestão
// real; RPCs (owner por phone_number_id e registro no ledger) mockadas com um
// ledger em memória que reproduz a idempotência por event_key. Nenhuma rede,
// nenhum Graph, nenhum banco real, nenhum segredo real.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ownerByPhoneNumber: vi.fn(),
  register: vi.fn(),
  createAdminClient: vi.fn(),
  waitUntil: vi.fn(),
  ingestLeadgenChange: vi.fn(),
}));

vi.mock('@/lib/server/whatsapp-connection/connection-rpc', () => ({
  createWhatsAppConnectionRpcPort: () => ({ ownerByPhoneNumber: mocks.ownerByPhoneNumber }),
}));
vi.mock('@/lib/server/whatsapp-webhook/events-rpc', () => ({ registerWhatsAppEvent: mocks.register }));
vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/server/meta-webhook/ingestion', () => ({ ingestLeadgenChange: mocks.ingestLeadgenChange }));

import { POST } from '@/app/api/webhooks/whatsapp/route';

const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/whatsapp';

const PHONE_A = '106540352242922';
const PHONE_B = '106540352242933';
const PHONE_UNKNOWN = '106540352249999';
const WABA_ID = '102290129340398';
const COMPANY_A = 'fa3eeeee-1111-1111-1111-111111111111';
const COMPANY_B = 'fa3eeeee-2222-2222-2222-222222222222';
const CONN_A = 'fa3a0000-0000-0000-0000-00000000000a';
const CONN_B = 'fa3a0000-0000-0000-0000-00000000000b';
const CUSTOMER_PHONE = '5511987654321';
const CONTACT_NAME = 'Fulana de Tal Teste';
const MESSAGE_TEXT = 'Quero saber o preço do apartamento 302';
const WAMID_1 = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==';
const WAMID_2 = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAyAA==';
const WAMID_OUT = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABEYEjAwMDAwMDAwMDAwMDAwMDAwMwA=';
const SENSITIVE = [PHONE_A, PHONE_B, PHONE_UNKNOWN, WABA_ID, CUSTOMER_PHONE, CONTACT_NAME, MESSAGE_TEXT, WAMID_1,
  WAMID_2, WAMID_OUT, APP_SECRET];

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;
}

function post(body: string): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) },
  });
}

function message(id: string, type = 'text') {
  return { from: CUSTOMER_PHONE, id, timestamp: '1730000000', text: { body: MESSAGE_TEXT }, type };
}

function status(id: string, value: string) {
  return { id, status: value, timestamp: '1730000001', recipient_id: CUSTOMER_PHONE };
}

function value(phoneNumberId: string, extra: Record<string, unknown>) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550783881', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: CONTACT_NAME }, wa_id: CUSTOMER_PHONE }],
    ...extra,
  };
}

function body(...changes: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: WABA_ID, changes: changes.map((v) => ({ field: 'messages', value: v })) }],
  });
}

// Ledger em memória com a mesma chave idempotente da RPC.
let ledger: Map<string, Record<string, unknown>>;
let fetchSpy: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function loggedJson(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .filter((a) => a[0] === '[whatsapp-webhook]')
    .map((a) => JSON.parse(String(a[1])) as Record<string, unknown>);
}

function loggedText(): string {
  return [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => a.join(' ')).join('\n');
}

beforeEach(() => {
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'fake-verify');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_INGESTION_ENABLED', 'true');
  ledger = new Map();
  mocks.ownerByPhoneNumber.mockImplementation(async (phoneNumberId: string) => {
    if (phoneNumberId === PHONE_A) return { data: [{ connection_id: CONN_A, company_id: COMPANY_A, status: 'connected' }], error: null };
    if (phoneNumberId === PHONE_B) return { data: [{ connection_id: CONN_B, company_id: COMPANY_B, status: 'connected' }], error: null };
    return { data: [], error: null };
  });
  mocks.register.mockImplementation(async (input: Record<string, unknown>) => {
    // Mesmo material da RPC: o status entra só pelo hash do valor bruto.
    const key = [input.eventKind, input.phoneNumberId, input.messageIdHash, input.statusKeyHash ?? '-'].join(':');
    const existing = ledger.get(key);
    if (existing) return { ok: true, value: { eventId: existing.id, created: false } };
    const row = { id: `evt-${ledger.size + 1}`, ...input };
    ledger.set(key, row);
    return { ok: true, value: { eventId: row.id, created: true } };
  });
  fetchSpy = vi.fn(() => {
    throw new Error('network is forbidden in this test');
  });
  vi.stubGlobal('fetch', fetchSpy);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.waitUntil).not.toHaveBeenCalled();
  expect(mocks.ingestLeadgenChange).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('flag WHATSAPP_INGESTION_ENABLED', () => {
  it.each([
    ['ausente', undefined],
    ['"false"', 'false'],
    ['"TRUE" (só "true" exato liga)', 'TRUE'],
    ['"1"', '1'],
  ])('flag %s → comportamento da W1: zero ingestão, logs idênticos', async (_label, flag) => {
    if (flag === undefined) vi.stubEnv('WHATSAPP_INGESTION_ENABLED', undefined as unknown as string);
    else vi.stubEnv('WHATSAPP_INGESTION_ENABLED', flag);
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    const lines = loggedJson();
    expect(lines.map((l) => l.result)).toEqual(['classified', 'accepted']);
    expect(lines.some((l) => 'registeredCount' in l)).toBe(false);
  });
});

describe('flag ON — resolução phone_number_id → company e ledger', () => {
  it('mensagem de número conectado → registrada na company correta, com hash do wamid', async () => {
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledWith(PHONE_A);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    const input = mocks.register.mock.calls[0][0];
    expect(input).toMatchObject({
      connectionId: CONN_A,
      companyId: COMPANY_A,
      phoneNumberId: PHONE_A,
      eventKind: 'message',
      messageType: 'text',
      statusValue: null,
    });
    expect(input.messageIdHash).toBe(
      createHash('sha256').update(`whatsapp-message-id:v1:${WAMID_1}`, 'utf8').digest('hex'),
    );
    expect(input.occurredAt).toEqual(new Date(1730000000 * 1000));
    // Nada do contato chega ao registro.
    expect(JSON.stringify(input)).not.toContain(WAMID_1);
    expect(JSON.stringify(input)).not.toContain(CUSTOMER_PHONE);
    expect(JSON.stringify(input)).not.toContain(CONTACT_NAME);
    expect(JSON.stringify(input)).not.toContain(MESSAGE_TEXT);
    expect(loggedJson().find((l) => l.result === 'ingestion')).toMatchObject({
      registeredCount: 1,
      duplicateCount: 0,
      unknownNumberCount: 0,
      unusableCount: 0,
    });
  });

  it('evento duplicado (reentrega da Meta) não cria segundo ledger', async () => {
    const payload = body(value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'read')] }));
    expect((await POST(post(payload))).status).toBe(200);
    expect((await POST(post(payload))).status).toBe(200);
    expect(ledger.size).toBe(2);
    const ingestionLines = loggedJson().filter((l) => l.result === 'ingestion');
    expect(ingestionLines[0]).toMatchObject({ registeredCount: 2, duplicateCount: 0 });
    expect(ingestionLines[1]).toMatchObject({ registeredCount: 0, duplicateCount: 2 });
  });

  it('múltiplos messages no mesmo payload → um registro por mensagem; owner resolvido uma vez por número', async () => {
    const res = await POST(
      post(body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2, 'image')] }))),
    );
    expect(res.status).toBe(200);
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledTimes(1);
    expect(mocks.register.mock.calls.map((c) => c[0].messageType)).toEqual(['text', 'image']);
    expect(ledger.size).toBe(2);
  });

  it('múltiplos statuses → cada transição é um evento; mesmo wamid de mensagem e status não colidem', async () => {
    const payload = body(
      value(PHONE_A, { statuses: [status(WAMID_OUT, 'sent'), status(WAMID_OUT, 'delivered'), status(WAMID_OUT, 'read')] }),
      value(PHONE_A, { messages: [message(WAMID_OUT)] }),
    );
    const res = await POST(post(payload));
    expect(res.status).toBe(200);
    expect(mocks.register.mock.calls.map((c) => [c[0].eventKind, c[0].statusValue])).toEqual([
      ['status', 'sent'],
      ['status', 'delivered'],
      ['status', 'read'],
      ['message', null],
    ]);
    expect(ledger.size).toBe(4);
  });

  it('dois statuses DESCONHECIDOS distintos do mesmo wamid → event_keys distintas, ambos "other", bruto nunca sai', async () => {
    const RAW_X = 'x_unknown_status_alpha';
    const RAW_Y = 'y_unknown_status_beta';
    const payload = body(value(PHONE_A, { statuses: [status(WAMID_OUT, RAW_X), status(WAMID_OUT, RAW_Y)] }));
    const res = await POST(post(payload));
    expect(res.status).toBe(200);

    const inputs = mocks.register.mock.calls.map((c) => c[0]);
    expect(inputs.map((i) => i.statusValue)).toEqual(['other', 'other']);
    expect(inputs.map((i) => i.messageIdHash)[0]).toBe(inputs.map((i) => i.messageIdHash)[1]);
    expect(inputs[0].statusKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inputs[0].statusKeyHash).not.toBe(inputs[1].statusKeyHash);
    expect(inputs[0].statusKeyHash).toBe(
      createHash('sha256').update(`whatsapp-status-key:v1:s:${RAW_X}`, 'utf8').digest('hex'),
    );
    expect(ledger.size).toBe(2);
    expect(loggedJson().find((l) => l.result === 'ingestion')).toMatchObject({ registeredCount: 2, duplicateCount: 0 });

    // Reentrega dos dois → ambos deduplicados.
    await POST(post(payload));
    expect(ledger.size).toBe(2);
    expect(loggedJson().filter((l) => l.result === 'ingestion').at(-1)).toMatchObject({ registeredCount: 0, duplicateCount: 2 });

    // O valor bruto não chega ao registro, aos logs nem à resposta.
    for (const raw of [RAW_X, RAW_Y]) {
      expect(JSON.stringify(inputs)).not.toContain(raw);
      expect(loggedText()).not.toContain(raw);
    }
  });

  it('status bruto não-string ou ausente gera chave determinística, distinta da string equivalente', async () => {
    const payload = body(value(PHONE_A, { statuses: [
      { id: WAMID_OUT, timestamp: '1' },
      { id: WAMID_OUT, status: 'null', timestamp: '1' },
      { id: WAMID_OUT, status: 7, timestamp: '1' },
    ] }));
    await POST(post(payload));
    const keys = mocks.register.mock.calls.map((c) => c[0].statusKeyHash);
    expect(new Set(keys).size).toBe(3);
    expect(mocks.register.mock.calls.map((c) => c[0].statusValue)).toEqual(['other', 'other', 'other']);
  });

  it('owner resolvido no máximo UMA vez por phone_number_id único na entrega (5 msgs A + 3 statuses A + 2 msgs B → 2 lookups)', async () => {
    const msgsA = Array.from({ length: 5 }, (_, i) => message(`wamid.A${i}`));
    const statusesA = ['sent', 'delivered', 'read'].map((s) => status(WAMID_OUT, s));
    const msgsB = Array.from({ length: 2 }, (_, i) => message(`wamid.B${i}`));
    // Espalhados em entries/changes diferentes, intercalando A e B.
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        { id: WABA_ID, changes: [
          { field: 'messages', value: value(PHONE_A, { messages: msgsA.slice(0, 3) }) },
          { field: 'messages', value: value(PHONE_B, { messages: msgsB.slice(0, 1) }) },
        ] },
        { id: WABA_ID, changes: [
          { field: 'messages', value: value(PHONE_A, { statuses: statusesA, messages: msgsA.slice(3) }) },
          { field: 'messages', value: value(PHONE_B, { messages: msgsB.slice(1) }) },
        ] },
      ],
    });
    const res = await POST(post(payload));
    expect(res.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledTimes(10);
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledTimes(2);
    expect(mocks.ownerByPhoneNumber.mock.calls.map((c) => c[0]).sort()).toEqual([PHONE_A, PHONE_B].sort());
    expect(loggedJson().find((l) => l.result === 'ingestion')).toMatchObject({ registeredCount: 10 });

    // O cache é por entrega: um novo POST resolve de novo (sem cache stale entre requests).
    await POST(post(payload));
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledTimes(4);
  });

  it('número desconhecido e falha de owner também são resolvidos uma vez só por entrega', async () => {
    const payload = body(value(PHONE_UNKNOWN, { messages: [message(WAMID_1), message(WAMID_2)], statuses: [status(WAMID_OUT, 'read')] }));
    await POST(post(payload));
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledTimes(1);
    mocks.ownerByPhoneNumber.mockClear();
    mocks.ownerByPhoneNumber.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    const res = await POST(post(payload));
    expect(res.status).toBe(503);
    expect(mocks.ownerByPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it('dois números de companies diferentes no mesmo payload → cada evento na sua company', async () => {
    const payload = body(
      value(PHONE_A, { messages: [message(WAMID_1)] }),
      value(PHONE_B, { messages: [message(WAMID_2)] }),
    );
    await POST(post(payload));
    expect(mocks.register.mock.calls.map((c) => [c[0].phoneNumberId, c[0].companyId, c[0].connectionId])).toEqual([
      [PHONE_A, COMPANY_A, CONN_A],
      [PHONE_B, COMPANY_B, CONN_B],
    ]);
  });

  it('número desconhecido → nada registrado, 200 (sem reentrega infinita)', async () => {
    const res = await POST(post(body(value(PHONE_UNKNOWN, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(loggedJson().find((l) => l.result === 'ingestion')).toMatchObject({ unknownNumberCount: 1, registeredCount: 0 });
  });

  it('evento sem phone_number_id ou sem id → inutilizável, sem lookup', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [
        { field: 'messages', value: { messages: [message(WAMID_1)] } },
        { field: 'messages', value: value(PHONE_A, { messages: [{ type: 'text' }] }) },
        { field: 'messages', value: value('abc', { messages: [message(WAMID_2)] }) },
      ] }],
    });
    const res = await POST(post(payload));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPhoneNumber).not.toHaveBeenCalled();
    expect(loggedJson().find((l) => l.result === 'ingestion')).toMatchObject({ unusableCount: 3 });
  });

  it('payload sem eventos com flag ON → sem lookup, mesmo resumo da W1', async () => {
    const res = await POST(post(JSON.stringify({ object: 'whatsapp_business_account', entry: [] })));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPhoneNumber).not.toHaveBeenCalled();
    expect(loggedJson().map((l) => l.result)).toEqual(['ignored_no_events']);
  });

  it('falha no lookup de owner → 503 (Meta reentrega; registro é idempotente)', async () => {
    mocks.ownerByPhoneNumber.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(loggedJson().at(-1)).toMatchObject({ result: 'ingestion_infra_failure' });
  });

  it('owner lança exceção → 503, sem vazar a mensagem do erro', async () => {
    mocks.ownerByPhoneNumber.mockRejectedValue(new Error(`boom ${PHONE_A} supabase_admin_client_misconfigured`));
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(loggedText()).not.toContain('boom');
  });

  it('falha no registro de um evento → 503, demais eventos continuam registrados', async () => {
    mocks.register.mockResolvedValueOnce({ ok: false, code: 'register_failed' });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2)] }))));
    expect(res.status).toBe(503);
    expect(mocks.register).toHaveBeenCalledTimes(2);
    expect(ledger.size).toBe(1);
  });

  it('assinatura inválida com flag ON → 403 antes de qualquer lookup', async () => {
    const raw = body(value(PHONE_A, { messages: [message(WAMID_1)] }));
    const res = await POST(new Request(ENDPOINT, {
      method: 'POST',
      body: raw,
      headers: { 'X-Hub-Signature-256': sign('outro corpo') },
    }));
    expect(res.status).toBe(403);
    expect(mocks.ownerByPhoneNumber).not.toHaveBeenCalled();
  });

  it('nenhum token/PII/ID externo em logs ou respostas com flag ON', async () => {
    const responses: string[] = [];
    const payload = body(
      value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'failed')] }),
      value(PHONE_UNKNOWN, { messages: [message(WAMID_2)] }),
    );
    responses.push(await (await POST(post(payload))).text());
    mocks.ownerByPhoneNumber.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    responses.push(await (await POST(post(payload))).text());
    const logged = loggedText();
    for (const value of [...SENSITIVE, COMPANY_A, CONN_A]) {
      expect(logged).not.toContain(value);
      for (const r of responses) expect(r).not.toContain(value);
    }
    expect(logged).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('Lead Ads sem regressão', () => {
  it('webhook do Lead Ads não importa nada do WhatsApp e o WhatsApp não importa ingestão Lead Ads', () => {
    const root = process.cwd();
    const metaFiles = ['app/api/webhooks/meta/route.ts', 'lib/server/meta-webhook/ingestion.ts',
      'lib/server/meta-webhook/env.ts', 'lib/server/meta-oauth/token-crypto.ts'];
    for (const file of metaFiles) {
      expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(/whatsapp/i);
    }
    const ingestion = readFileSync(resolve(root, 'lib/server/whatsapp-webhook/ingestion.ts'), 'utf8');
    expect(ingestion).not.toMatch(/meta-webhook|meta-oauth/);
  });
});
