// persistWhatsAppConnection (W2A): cifra com a chave do WhatsApp e chama a
// RPC de upsert. RPC fake em memória que reproduz as regras do banco
// (reconnect idempotente; número conectado em outra company é recusado).
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { persistWhatsAppConnection } from '@/lib/server/whatsapp-connection/connection-persistence';
import type { WhatsAppConnectionRpcPort, WhatsAppUpsertRpcArgs } from '@/lib/server/whatsapp-connection/connection-rpc';
import { decryptWhatsAppAccessToken } from '@/lib/server/whatsapp-connection/token-crypto';

const KEY = randomBytes(32);
const COMPANY_A = 'fa5eeeee-1111-1111-1111-111111111111';
const COMPANY_B = 'fa5eeeee-2222-2222-2222-222222222222';
const PHONE = '106540352242922';
const WABA = '102290129340398';
const TOKEN = 'EAAG-fake-whatsapp-token-for-persistence-tests';

function fakeDb() {
  const rows = new Map<string, { id: string; company_id: string; phone: string; status: string; ciphertext: string }>();
  const calls: WhatsAppUpsertRpcArgs[] = [];
  const port: WhatsAppConnectionRpcPort = {
    async upsert(args) {
      calls.push(args);
      const owner = [...rows.values()].find((r) => r.status === 'connected' && r.phone === args.p_phone_number_id);
      if (owner && owner.company_id !== args.p_company_id) {
        return { data: null, error: { code: 'P0001', message: 'phone_number_already_connected' } };
      }
      const key = `${args.p_company_id}:${args.p_phone_number_id}`;
      const row = rows.get(key) ?? {
        id: `conn-${rows.size + 1}`, company_id: args.p_company_id, phone: args.p_phone_number_id, status: 'connected', ciphertext: '',
      };
      row.ciphertext = args.p_access_token_ciphertext;
      rows.set(key, row);
      return {
        data: [{ id: row.id, company_id: row.company_id, waba_id: args.p_waba_id, phone_number_id: args.p_phone_number_id,
          display_phone_number: args.p_display_phone_number, status: 'connected', connected_at: args.p_connected_at }],
        error: null,
      };
    },
    ownerByPhoneNumber: vi.fn(),
  };
  return { rows, calls, deps: { rpc: () => port, getKey: () => KEY } };
}

const input = (companyId: string) => ({
  companyId,
  wabaId: WABA,
  phoneNumberId: PHONE,
  displayPhoneNumber: '+1 555-078-3881',
  accessToken: TOKEN,
  connectedBy: null,
});

describe('persistWhatsAppConnection', () => {
  it('conexão por company: envia só ciphertext v1 decifrável com AAD da company + número', async () => {
    const db = fakeDb();
    const result = await persistWhatsAppConnection(input(COMPANY_A), db.deps);
    expect(result).toEqual({ ok: true, value: { connectionId: 'conn-1', companyId: COMPANY_A, status: 'connected' } });
    const args = db.calls[0];
    expect(JSON.stringify(args)).not.toContain(TOKEN);
    expect(args.p_token_key_version).toBe(1);
    expect(args.p_access_token_ciphertext.startsWith('v1.')).toBe(true);
    expect(decryptWhatsAppAccessToken({ companyId: COMPANY_A, phoneNumberId: PHONE, keyVersion: 1,
      ciphertext: args.p_access_token_ciphertext, key: KEY })).toBe(TOKEN);
  });

  it('resultado nunca contém token nem ciphertext', async () => {
    const db = fakeDb();
    const result = await persistWhatsAppConnection(input(COMPANY_A), db.deps);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain('v1.');
  });

  it('reconnect idempotente na mesma company: mesma conexão, ciphertext renovado', async () => {
    const db = fakeDb();
    const first = await persistWhatsAppConnection(input(COMPANY_A), db.deps);
    const second = await persistWhatsAppConnection(input(COMPANY_A), db.deps);
    expect(first.ok && second.ok && first.value.connectionId === second.value.connectionId).toBe(true);
    expect(db.rows.size).toBe(1);
    expect(db.calls[0].p_access_token_ciphertext).not.toBe(db.calls[1].p_access_token_ciphertext);
  });

  it('mesmo phone_number_id em outra company → phone_number_already_connected', async () => {
    const db = fakeDb();
    await persistWhatsAppConnection(input(COMPANY_A), db.deps);
    const result = await persistWhatsAppConnection(input(COMPANY_B), db.deps);
    expect(result).toEqual({ ok: false, code: 'phone_number_already_connected' });
    expect(db.rows.size).toBe(1);
  });

  it('chave ausente → key_unavailable, sem chamar a RPC', async () => {
    const db = fakeDb();
    const result = await persistWhatsAppConnection(input(COMPANY_A), {
      ...db.deps,
      getKey: () => {
        throw new Error('whatsapp_token_encryption_key_v1_invalid');
      },
    });
    expect(result).toEqual({ ok: false, code: 'key_unavailable' });
    expect(db.calls).toHaveLength(0);
  });

  it('contexto inválido → encrypt_failed; erro genérico do banco → persist_failed', async () => {
    const db = fakeDb();
    expect(await persistWhatsAppConnection({ ...input(COMPANY_A), phoneNumberId: 'abc' }, db.deps))
      .toEqual({ ok: false, code: 'encrypt_failed' });
    const failing = { rpc: () => ({ upsert: async () => ({ data: null, error: { message: 'connection reset' } }), ownerByPhoneNumber: vi.fn() }), getKey: () => KEY };
    expect(await persistWhatsAppConnection(input(COMPANY_A), failing)).toEqual({ ok: false, code: 'persist_failed' });
    const throwing = { rpc: () => { throw new Error('supabase_admin_client_misconfigured'); }, getKey: () => KEY };
    expect(await persistWhatsAppConnection(input(COMPANY_A), throwing)).toEqual({ ok: false, code: 'persist_failed' });
  });
});
