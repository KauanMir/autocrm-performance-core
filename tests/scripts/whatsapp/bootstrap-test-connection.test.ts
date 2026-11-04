// @vitest-environment node
// Bootstrap one-shot da conexão de TESTE (W2A): validação local, preflight
// somente leitura, Graph obrigatória antes da escrita, UMA escrita
// (whatsapp_connection_upsert) com a AAD W2A, ida e volta, saída higienizada
// e limpeza. Supabase e Graph são fakes em memória — nenhuma rede.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_ENV_NAMES,
  createBootstrapGraphPort,
  GRAPH_API_VERSION,
  parseBootstrapEnv,
  PRODUCTION_SUPABASE_URL,
  runBootstrapCli,
  runWhatsAppTestConnectionBootstrap,
  TEST_COMPANY_ID,
  type BootstrapEnv,
  type BootstrapGraphPort,
  type BootstrapInput,
  type BootstrapSummary,
  type BootstrapSupabasePort,
  type GraphGetResult,
} from '@/scripts/whatsapp/bootstrap-test-connection-core';
import { openAeadEnvelope } from '@/lib/server/crypto/aead-envelope';
import { DEFAULT_GRAPH_API_VERSION, META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
import type { WhatsAppUpsertRpcArgs } from '@/lib/server/whatsapp-connection/connection-rpc';

const ROOT = process.cwd();
const CORE_SOURCE = readFileSync(join(ROOT, 'scripts/whatsapp/bootstrap-test-connection-core.ts'), 'utf8');
const ENTRY_SOURCE = readFileSync(join(ROOT, 'scripts/whatsapp/bootstrap-test-connection.ts'), 'utf8');
const LAUNCHER_SOURCE = readFileSync(join(ROOT, 'scripts/whatsapp/bootstrap-test-connection.ps1'), 'utf8');

const KEY_HEX = randomBytes(32).toString('hex');
const TOKEN = 'EAAG-fake-whatsapp-bootstrap-token-0123456789';
const WABA = '102290129340398';
const PHONE = '106540352242922';
const DISPLAY = '+1 555-078-3881';
const OTHER_COMPANY = 'fa5eeeee-2222-2222-2222-222222222222';
const PROFILE = 'fa5eeeee-3333-3333-3333-333333333333';
const EXACT_AAD = `whatsapp-access-token:v1:${TEST_COMPANY_ID}:${PHONE}`;

function fakeJwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.c2lnbmF0dXJlLWZha2U`;
}

const SERVICE_ROLE = fakeJwt({ iss: 'supabase', ref: 'qglirrsyhdfbgkmchwcw', role: 'service_role' });
const SECRETS_AND_IDS = [TOKEN, KEY_HEX, SERVICE_ROLE, WABA, PHONE, DISPLAY, '555-078', EXACT_AAD];

function validEnv(overrides: BootstrapEnv = {}): BootstrapEnv {
  return {
    WA_BOOTSTRAP_ACCESS_TOKEN: TOKEN,
    WA_BOOTSTRAP_SERVICE_ROLE_KEY: SERVICE_ROLE,
    WA_BOOTSTRAP_ENCRYPTION_KEY: KEY_HEX,
    WA_BOOTSTRAP_WABA_ID: WABA,
    WA_BOOTSTRAP_PHONE_NUMBER_ID: PHONE,
    WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER: DISPLAY,
    WA_BOOTSTRAP_CONNECTED_BY: PROFILE,
    WA_BOOTSTRAP_CONFIRM: 'TEST_COMPANY_ONLY',
    WA_BOOTSTRAP_MODE: 'write',
    ...overrides,
  };
}

function validInput(overrides: Partial<BootstrapInput> = {}): BootstrapInput {
  const parsed = parseBootstrapEnv(validEnv());
  if (parsed.ok === false) throw new Error('fixture invalid');
  return { ...parsed.input, ...overrides };
}

interface FakeRow {
  id: string;
  company_id: string;
  phone: string;
  waba: string;
  status: string;
  ciphertext: string;
}

// Registra TODA chamada: a superfície do bootstrap é só esta, e a única
// escrita possível é upsert. Não há método que escreva no ledger de eventos.
function fakeSupabase(options: { rows?: FakeRow[]; companyExists?: boolean | null; eventsProbe?: 'protected' | 'unexpected' } = {}) {
  const rows = [...(options.rows ?? [])];
  const calls: string[] = [];
  const upsertCalls: WhatsAppUpsertRpcArgs[] = [];
  const port: BootstrapSupabasePort = {
    companyExists: vi.fn(async (id: string) => {
      calls.push('companyExists');
      return options.companyExists === undefined ? id === TEST_COMPANY_ID : options.companyExists;
    }),
    profileExists: vi.fn(async (id: string) => {
      calls.push('profileExists');
      return id === PROFILE;
    }),
    eventsTableProbe: vi.fn(async () => {
      calls.push('eventsTableProbe');
      return options.eventsProbe ?? 'protected';
    }),
    ownerByPhoneNumber: vi.fn(async (phone: string) => {
      calls.push('ownerByPhoneNumber');
      return {
        data: rows
          .filter((r) => r.phone === phone && r.status === 'connected')
          .map((r) => ({ connection_id: r.id, company_id: r.company_id, status: r.status })),
        error: null,
      };
    }),
    upsert: vi.fn(async (args: WhatsAppUpsertRpcArgs) => {
      calls.push('upsert');
      upsertCalls.push(args);
      let row = rows.find((r) => r.company_id === args.p_company_id && r.phone === args.p_phone_number_id);
      if (!row) {
        row = { id: `conn-${rows.length + 1}`, company_id: args.p_company_id, phone: args.p_phone_number_id, waba: '', status: 'connected', ciphertext: '' };
        rows.push(row);
      }
      row.waba = args.p_waba_id;
      row.ciphertext = args.p_access_token_ciphertext;
      row.status = 'connected';
      return {
        data: [{ id: row.id, company_id: row.company_id, waba_id: row.waba, phone_number_id: row.phone,
          display_phone_number: args.p_display_phone_number, status: 'connected', connected_at: args.p_connected_at }],
        error: null,
      };
    }),
    lookupForProcessing: vi.fn(async (phone: string) => {
      calls.push('lookupForProcessing');
      return {
        data: rows
          .filter((r) => r.phone === phone && r.status === 'connected')
          .map((r) => ({ connection_id: r.id, company_id: r.company_id, waba_id: r.waba, phone_number_id: r.phone,
            status: r.status, access_token_ciphertext: r.ciphertext, token_key_version: 1 })),
        error: null,
      };
    }),
  };
  return { port, rows, calls, upsertCalls };
}

function fakeGraph(overrides: { phone?: GraphGetResult; waba?: GraphGetResult } = {}) {
  const port: BootstrapGraphPort = {
    get: vi.fn(async (path: string): Promise<GraphGetResult> => {
      if (path === PHONE) return overrides.phone ?? { ok: true, body: { id: PHONE, display_phone_number: '+1 555-078-3881' } };
      if (path === `${WABA}/phone_numbers`) {
        return overrides.waba ?? { ok: true, body: { data: [{ id: '999' }, { id: PHONE }] } };
      }
      return { ok: false, httpStatus: 404, graphCode: 100 };
    }),
  };
  return { port };
}

function expectSanitized(output: unknown, extra: string[] = []): void {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  for (const value of [...SECRETS_AND_IDS, ...extra]) expect(text).not.toContain(value);
  expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\./);
  expect(text).not.toContain('Bearer');
}

const SUMMARY_KEYS = [
  'alreadyConnected', 'code', 'company', 'connectionStatus', 'createdOrUpdated', 'durationMs', 'failedStep',
  'graphCode', 'graphDisplayMatches', 'graphHttpStatus', 'graphPhoneFound', 'graphPhoneMatchesWaba',
  'graphTokenValid', 'graphWabaAccessible', 'keyVersion', 'mode', 'roundTripOk', 'success',
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('constantes fixas', () => {
  it('TEST COMPANY, URL de produção e versão Graph fixas e alinhadas ao código existente', () => {
    expect(TEST_COMPANY_ID).toBe(META_TEST_COMPANY_ID);
    expect(TEST_COMPANY_ID).toBe('0dfc73ee-bca9-4fdf-aa50-b227940b2869');
    expect(PRODUCTION_SUPABASE_URL).toBe('https://qglirrsyhdfbgkmchwcw.supabase.co');
    expect(GRAPH_API_VERSION).toBe(DEFAULT_GRAPH_API_VERSION);
    expect(BOOTSTRAP_ENV_NAMES).not.toContain('WA_BOOTSTRAP_SUPABASE_URL');
    expect(BOOTSTRAP_ENV_NAMES).not.toContain('WA_BOOTSTRAP_COMPANY_ID');
  });
});

describe('parseBootstrapEnv — validação local', () => {
  it('modo ausente → dry-run; env válida → input completo', () => {
    const parsed = parseBootstrapEnv(validEnv({ WA_BOOTSTRAP_MODE: undefined }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) return;
    expect(parsed.input.mode).toBe('dry-run');
    expect(parsed.input.encryptionKey.equals(Buffer.from(KEY_HEX, 'hex'))).toBe(true);
    expect(parsed.input.displayPhoneNumber).toBe(DISPLAY);
    expect(parsed.input.connectedBy).toBe(PROFILE);
  });

  it.each([['dry-run', 'dry-run'], ['', 'dry-run'], ['write', 'write']])('WA_BOOTSTRAP_MODE=%j → %s', (raw, mode) => {
    const parsed = parseBootstrapEnv(validEnv({ WA_BOOTSTRAP_MODE: raw }));
    expect(parsed.ok === true && parsed.input.mode).toBe(mode);
  });

  it.each<[string, BootstrapEnv, string]>([
    ['confirmação ausente', { WA_BOOTSTRAP_CONFIRM: undefined }, 'confirm_invalid'],
    ['confirmação diferente', { WA_BOOTSTRAP_CONFIRM: 'test_company_only' }, 'confirm_invalid'],
    ['modo desconhecido', { WA_BOOTSTRAP_MODE: 'force' }, 'mode_invalid'],
    ['modo com caixa diferente', { WA_BOOTSTRAP_MODE: 'WRITE' }, 'mode_invalid'],
    ['chave maiúscula', { WA_BOOTSTRAP_ENCRYPTION_KEY: KEY_HEX.toUpperCase().replace(/^[0-9]/, 'A') }, 'encryption_key_invalid'],
    ['chave curta', { WA_BOOTSTRAP_ENCRYPTION_KEY: KEY_HEX.slice(0, 62) }, 'encryption_key_invalid'],
    ['chave ausente', { WA_BOOTSTRAP_ENCRYPTION_KEY: undefined }, 'encryption_key_invalid'],
    ['token vazio', { WA_BOOTSTRAP_ACCESS_TOKEN: '' }, 'access_token_invalid'],
    ['token com quebra de linha', { WA_BOOTSTRAP_ACCESS_TOKEN: `${TOKEN}\n` }, 'access_token_invalid'],
    ['service role ausente', { WA_BOOTSTRAP_SERVICE_ROLE_KEY: undefined }, 'service_role_key_invalid'],
    ['service role de outro projeto', { WA_BOOTSTRAP_SERVICE_ROLE_KEY: fakeJwt({ ref: 'scjkyzdagwkscuxydgld', role: 'service_role' }) }, 'service_role_key_invalid'],
    ['anon key de produção', { WA_BOOTSTRAP_SERVICE_ROLE_KEY: fakeJwt({ ref: 'qglirrsyhdfbgkmchwcw', role: 'anon' }) }, 'service_role_key_invalid'],
    ['WABA não numérica', { WA_BOOTSTRAP_WABA_ID: 'abc' }, 'waba_id_invalid'],
    ['WABA ausente', { WA_BOOTSTRAP_WABA_ID: undefined }, 'waba_id_invalid'],
    ['phone_number_id não numérico', { WA_BOOTSTRAP_PHONE_NUMBER_ID: '10654-0352' }, 'phone_number_id_invalid'],
    ['phone_number_id ausente', { WA_BOOTSTRAP_PHONE_NUMBER_ID: undefined }, 'phone_number_id_invalid'],
    ['WABA igual ao phone_number_id', { WA_BOOTSTRAP_WABA_ID: PHONE }, 'waba_id_equals_phone_number_id'],
    ['display com letras', { WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER: '+1 555 CALL' }, 'display_phone_number_invalid'],
    ['connected_by inválido', { WA_BOOTSTRAP_CONNECTED_BY: 'not-a-uuid' }, 'connected_by_invalid'],
  ])('%s → aborta com código fixo, sem ecoar valores', (_label, overrides, code) => {
    const parsed = parseBootstrapEnv(validEnv(overrides));
    expect(parsed).toEqual({ ok: false, code });
  });

  it('chave sb_secret_ é aceita; display e connected_by vazios viram null', () => {
    const parsed = parseBootstrapEnv(validEnv({
      WA_BOOTSTRAP_SERVICE_ROLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz012345',
      WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER: '  ',
      WA_BOOTSTRAP_CONNECTED_BY: '',
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) return;
    expect(parsed.input.displayPhoneNumber).toBeNull();
    expect(parsed.input.connectedBy).toBeNull();
  });
});

describe('runWhatsAppTestConnectionBootstrap — dry-run × write', () => {
  it('dry-run: preflight + Graph passam e ZERO upsert / zero lookup de ciphertext', async () => {
    const db = fakeSupabase();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput({ mode: 'dry-run' }), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({
      success: true, mode: 'dry-run', company: 'TEST_COMPANY', failedStep: null, code: null,
      alreadyConnected: false, connectionStatus: null, graphTokenValid: true, graphWabaAccessible: true,
      graphPhoneFound: true, graphPhoneMatchesWaba: true, graphDisplayMatches: true,
      roundTripOk: null, keyVersion: null, createdOrUpdated: false,
    });
    expect(typeof summary.durationMs).toBe('number');
    expect(db.port.upsert).toHaveBeenCalledTimes(0);
    expect(db.calls).toEqual(['companyExists', 'profileExists', 'ownerByPhoneNumber', 'eventsTableProbe']);
    expectSanitized(summary);
  });

  it('write: EXATAMENTE um upsert, na TEST COMPANY, com o desenho aprovado; round-trip OK', async () => {
    const db = fakeSupabase();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });

    expect(summary).toMatchObject({
      success: true, mode: 'write', company: 'TEST_COMPANY', alreadyConnected: false, connectionStatus: 'connected',
      graphTokenValid: true, graphWabaAccessible: true, graphPhoneFound: true, graphPhoneMatchesWaba: true,
      roundTripOk: true, keyVersion: 1, createdOrUpdated: true,
    });
    expect(db.port.upsert).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual(['companyExists', 'profileExists', 'ownerByPhoneNumber', 'eventsTableProbe', 'upsert', 'lookupForProcessing']);
    const args = db.upsertCalls[0];
    expect(Object.keys(args).sort()).toEqual([
      'p_access_token_ciphertext', 'p_company_id', 'p_connected_at', 'p_connected_by', 'p_display_phone_number',
      'p_phone_number_id', 'p_token_key_version', 'p_waba_id',
    ]);
    expect(args).toMatchObject({
      p_company_id: TEST_COMPANY_ID, p_waba_id: WABA, p_phone_number_id: PHONE, p_display_phone_number: DISPLAY,
      p_token_key_version: 1, p_connected_by: PROFILE,
    });
    expect(JSON.stringify(args)).not.toContain(TOKEN);
    expect(JSON.stringify(args)).not.toContain(KEY_HEX);
    expectSanitized(summary, [args.p_access_token_ciphertext]);
  });

  it('crypto: ciphertext é envelope v1 que abre SÓ com a AAD exata whatsapp-access-token:v1:<company>:<phone>', async () => {
    const db = fakeSupabase();
    await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });
    const envelope = db.upsertCalls[0].p_access_token_ciphertext;
    const key = Buffer.from(KEY_HEX, 'hex');
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(openAeadEnvelope({ envelope, key, aad: EXACT_AAD, version: 'v1' })).toBe(TOKEN);
    expect(() => openAeadEnvelope({ envelope, key, aad: `whatsapp-access-token:v1:${OTHER_COMPANY}:${PHONE}`, version: 'v1' })).toThrow();
    expect(() => openAeadEnvelope({ envelope, key, aad: `whatsapp-access-token:v1:${TEST_COMPANY_ID}:999`, version: 'v1' })).toThrow();
    expect(() => openAeadEnvelope({ envelope, key: randomBytes(32), aad: EXACT_AAD, version: 'v1' })).toThrow();
  });

  it('Graph roda ANTES do upsert', async () => {
    const order: string[] = [];
    const db = fakeSupabase();
    const graph = fakeGraph();
    const graphGet = graph.port.get;
    graph.port.get = async (...a) => { order.push(`graph:${a[0] === PHONE ? 'phone' : 'waba'}`); return graphGet(...a); };
    const upsert = db.port.upsert;
    db.port.upsert = async (args) => { order.push('upsert'); return upsert(args); };
    await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: graph.port });
    expect(order).toEqual(['graph:phone', 'graph:waba', 'upsert']);
  });

  it('número já conectado em OUTRA company → aborta no preflight, sem Graph e sem escrita', async () => {
    const db = fakeSupabase({ rows: [{ id: 'conn-x', company_id: OTHER_COMPANY, phone: PHONE, waba: WABA, status: 'connected', ciphertext: 'v1.x' }] });
    const graph = fakeGraph();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: graph.port });
    expect(summary).toMatchObject({ success: false, failedStep: 'preflight', code: 'phone_number_connected_to_other_company', createdOrUpdated: false });
    expect(graph.port.get).not.toHaveBeenCalled();
    expect(db.port.upsert).not.toHaveBeenCalled();
    expectSanitized(summary, [OTHER_COMPANY]);
  });

  it('já conectado na TEST COMPANY → alreadyConnected: true; dry-run mostra status sem gravar', async () => {
    const rows = [{ id: 'conn-7', company_id: TEST_COMPANY_ID, phone: PHONE, waba: WABA, status: 'connected', ciphertext: 'v1.old' }];
    const db = fakeSupabase({ rows });
    const summary = await runWhatsAppTestConnectionBootstrap(validInput({ mode: 'dry-run' }), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: true, alreadyConnected: true, connectionStatus: 'connected', createdOrUpdated: false });
    expect(db.port.upsert).not.toHaveBeenCalled();
  });

  it('já conectado na TEST COMPANY + write → atualiza a mesma linha (um upsert) após a Graph', async () => {
    const db = fakeSupabase({ rows: [{ id: 'conn-7', company_id: TEST_COMPANY_ID, phone: PHONE, waba: WABA, status: 'connected', ciphertext: 'v1.old' }] });
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: true, alreadyConnected: true, roundTripOk: true, createdOrUpdated: true });
    expect(db.port.upsert).toHaveBeenCalledTimes(1);
    expect(db.rows).toHaveLength(1);
  });

  it.each<[string, Parameters<typeof fakeSupabase>[0], string]>([
    ['TEST COMPANY inexistente', { companyExists: false }, 'test_company_not_found'],
    ['consulta da company falha', { companyExists: null }, 'test_company_check_failed'],
    ['ledger de eventos não está protegido como esperado', { eventsProbe: 'unexpected' }, 'events_table_check_failed'],
  ])('%s → aborta no preflight sem Graph e sem escrita', async (_label, options, code) => {
    const db = fakeSupabase(options);
    const graph = fakeGraph();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: graph.port });
    expect(summary).toMatchObject({ success: false, failedStep: 'preflight', code, createdOrUpdated: false });
    expect(graph.port.get).not.toHaveBeenCalled();
    expect(db.port.upsert).not.toHaveBeenCalled();
  });

  it('connected_by inexistente → aborta no preflight', async () => {
    const db = fakeSupabase();
    const summary = await runWhatsAppTestConnectionBootstrap(
      validInput({ connectedBy: 'fa5eeeee-9999-9999-9999-999999999999' }),
      { supabase: db.port, graph: fakeGraph().port },
    );
    expect(summary).toMatchObject({ success: false, code: 'connected_by_not_found', createdOrUpdated: false });
    expect(db.port.upsert).not.toHaveBeenCalled();
  });

  it.each<[string, Parameters<typeof fakeGraph>[0], string, Partial<BootstrapSummary>]>([
    ['token inválido/expirado (190)', { phone: { ok: false, httpStatus: 400, graphCode: 190 } }, 'graph_token_invalid', { graphTokenValid: false, graphCode: 190, graphHttpStatus: 400 }],
    ['token rejeitado (401 sem código)', { phone: { ok: false, httpStatus: 401, graphCode: null } }, 'graph_token_invalid', { graphTokenValid: false }],
    ['phone_number_id ilegível (100)', { phone: { ok: false, httpStatus: 400, graphCode: 100 } }, 'graph_phone_number_unreadable', { graphPhoneFound: false, graphCode: 100 }],
    ['phone_number_id devolvido diferente', { phone: { ok: true, body: { id: '123' } } }, 'graph_phone_number_not_found', { graphTokenValid: true, graphPhoneFound: false }],
    ['WABA inacessível (200)', { waba: { ok: false, httpStatus: 403, graphCode: 200 } }, 'graph_waba_unreadable', { graphWabaAccessible: false, graphCode: 200 }],
    ['número não pertence à WABA', { waba: { ok: true, body: { data: [{ id: '999' }] } } }, 'graph_phone_number_not_in_waba', { graphWabaAccessible: true, graphPhoneMatchesWaba: false }],
    ['display divergente da Meta', { phone: { ok: true, body: { id: PHONE, display_phone_number: '+1 555-000-0000' } } }, 'graph_display_mismatch', { graphDisplayMatches: false }],
  ])('Graph: %s → aborta sem escrever', async (_label, overrides, code, extra) => {
    const db = fakeSupabase();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph(overrides).port });
    expect(summary).toMatchObject({ success: false, failedStep: 'graph', code, createdOrUpdated: false, ...extra });
    expect(db.port.upsert).not.toHaveBeenCalled();
    expectSanitized(summary);
  });

  it('sem display informado → não compara (graphDisplayMatches: null) e persiste null', async () => {
    const db = fakeSupabase();
    const summary = await runWhatsAppTestConnectionBootstrap(validInput({ displayPhoneNumber: null }), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: true, graphDisplayMatches: null });
    expect(db.upsertCalls[0].p_display_phone_number).toBeNull();
  });

  it('número em uso por outra company na hora do upsert → persist_phone_number_already_connected', async () => {
    const db = fakeSupabase();
    db.port.upsert = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'phone_number_already_connected' } }));
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: false, failedStep: 'persist', code: 'persist_phone_number_already_connected', createdOrUpdated: false });
    expect(db.port.upsert).toHaveBeenCalledTimes(1);
  });

  it('round-trip inválido → roundTripOk: false, falha, SEM segundo upsert e sem imprimir ciphertext', async () => {
    const db = fakeSupabase();
    const forged = 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    const lookup = db.port.lookupForProcessing;
    db.port.lookupForProcessing = async (phone) => {
      const result = await lookup(phone);
      return { ...result, data: (result.data ?? []).map((r) => ({ ...r, access_token_ciphertext: forged })) };
    };
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: false, failedStep: 'verify', code: 'verify_round_trip_failed', createdOrUpdated: true, roundTripOk: false });
    expect(db.port.upsert).toHaveBeenCalledTimes(1);
    expectSanitized(summary, [forged, db.upsertCalls[0].p_access_token_ciphertext]);
  });

  it('linha devolvida pelo lookup não confere → verify_row_mismatch, sem segundo upsert', async () => {
    const db = fakeSupabase();
    db.port.lookupForProcessing = vi.fn(async () => ({ data: [], error: null }));
    const summary = await runWhatsAppTestConnectionBootstrap(validInput(), { supabase: db.port, graph: fakeGraph().port });
    expect(summary).toMatchObject({ success: false, code: 'verify_row_mismatch', roundTripOk: null });
    expect(db.port.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('runBootstrapCli — orquestração, saída e limpeza', () => {
  function cli(env: Record<string, string | undefined>, overrides: { argv?: string[]; db?: ReturnType<typeof fakeSupabase>; graph?: BootstrapGraphPort } = {}) {
    const db = overrides.db ?? fakeSupabase();
    const printed: BootstrapSummary[] = [];
    const createSupabase = vi.fn(() => db.port);
    const createGraph = vi.fn(() => overrides.graph ?? fakeGraph().port);
    const consoleSpies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const stderrSpy = vi.spyOn(process.stderr, 'write');
    const done = runBootstrapCli({
      argv: overrides.argv ?? ['node', 'bootstrap-test-connection.ts'],
      env,
      print: (s) => printed.push(s),
      createSupabase,
      createGraph,
    });
    return { done, db, printed, createSupabase, createGraph, consoleSpies, stdoutSpy, stderrSpy };
  }

  function processLikeEnv(overrides: BootstrapEnv = {}): Record<string, string | undefined> {
    return { PATH: 'x', WHATSAPP_INGESTION_ENABLED: 'false', ...validEnv(overrides) };
  }

  it('modo ausente → dry-run: exit 0, zero upsert, uma saída com as chaves permitidas', async () => {
    const env = processLikeEnv({ WA_BOOTSTRAP_MODE: undefined });
    const run = cli(env);
    expect(await run.done).toBe(0);
    expect(run.db.port.upsert).not.toHaveBeenCalled();
    expect(run.printed).toHaveLength(1);
    expect(Object.keys(run.printed[0]).sort()).toEqual(SUMMARY_KEYS);
    expect(run.printed[0]).toMatchObject({ success: true, mode: 'dry-run', createdOrUpdated: false });
  });

  it('write → exit 0 e exatamente um upsert', async () => {
    const run = cli(processLikeEnv());
    expect(await run.done).toBe(0);
    expect(run.db.port.upsert).toHaveBeenCalledTimes(1);
    expect(run.printed[0]).toMatchObject({ success: true, mode: 'write', createdOrUpdated: true, roundTripOk: true, keyVersion: 1 });
  });

  it.each<[string, BootstrapEnv]>([
    ['confirmação errada', { WA_BOOTSTRAP_CONFIRM: 'yes' }],
    ['modo inválido', { WA_BOOTSTRAP_MODE: 'force' }],
    ['service role de outro projeto', { WA_BOOTSTRAP_SERVICE_ROLE_KEY: fakeJwt({ ref: 'scjkyzdagwkscuxydgld', role: 'service_role' }) }],
  ])('%s → exit 2 ANTES de qualquer rede (nenhum client criado)', async (_label, overrides) => {
    const run = cli(processLikeEnv(overrides));
    expect(await run.done).toBe(2);
    expect(run.createSupabase).not.toHaveBeenCalled();
    expect(run.createGraph).not.toHaveBeenCalled();
    expect(run.printed[0]).toMatchObject({ success: false, failedStep: 'input' });
  });

  it('argumento de linha de comando → recusado (exit 2) sem rede', async () => {
    const run = cli(processLikeEnv(), { argv: ['node', 'script.ts', TOKEN] });
    expect(await run.done).toBe(2);
    expect(run.createSupabase).not.toHaveBeenCalled();
    expect(run.printed[0]).toMatchObject({ code: 'unexpected_arguments' });
    expectSanitized(run.printed);
  });

  it('Graph falha → exit 1, sem escrita', async () => {
    const run = cli(processLikeEnv(), { graph: fakeGraph({ phone: { ok: false, httpStatus: 400, graphCode: 190 } }).port });
    expect(await run.done).toBe(1);
    expect(run.db.port.upsert).not.toHaveBeenCalled();
  });

  it('erro inesperado com segredo na mensagem → só unexpected_error; write fica createdOrUpdated: null', async () => {
    const env = processLikeEnv();
    const db = fakeSupabase();
    db.port.companyExists = async () => { throw new Error(`boom ${TOKEN} ${SERVICE_ROLE} ${KEY_HEX}`); };
    const run = cli(env, { db });
    expect(await run.done).toBe(1);
    expect(run.printed[0]).toMatchObject({ success: false, failedStep: 'unexpected', code: 'unexpected_error', createdOrUpdated: null });
    expectSanitized(run.printed);
  });

  it('nenhum segredo em stdout/stderr/console; só a saída injetada, sanitizada', async () => {
    const run = cli(processLikeEnv());
    await run.done;
    for (const spy of [...run.consoleSpies, run.stdoutSpy, run.stderrSpy]) {
      for (const call of spy.mock.calls) expectSanitized(call.map(String).join(' '));
    }
    expectSanitized(run.printed, [run.db.upsertCalls[0].p_access_token_ciphertext]);
  });

  it('finally: apaga todas as WA_BOOTSTRAP_* do env, zera a chave e não toca a flag de ingestão', async () => {
    const env = processLikeEnv();
    let capturedKey: Buffer | null = null;
    const runSpy = vi.fn(async (input: BootstrapInput) => {
      capturedKey = input.encryptionKey;
      for (const name of BOOTSTRAP_ENV_NAMES) expect(env[name]).toBeUndefined();
      throw new Error('falha no meio');
    });
    const exit = await runBootstrapCli({
      argv: ['node', 'x'], env, print: () => undefined,
      createSupabase: () => fakeSupabase().port, createGraph: () => fakeGraph().port, run: runSpy,
    });
    expect(exit).toBe(1);
    for (const name of BOOTSTRAP_ENV_NAMES) expect(name in env).toBe(false);
    expect(capturedKey).not.toBeNull();
    expect(capturedKey!.every((byte) => byte === 0)).toBe(true);
    expect(env.WHATSAPP_INGESTION_ENABLED).toBe('false');
    expect(env.PATH).toBe('x');
  });
});

describe('createBootstrapGraphPort', () => {
  it('token só no header Authorization; URL fixa da Graph sem token; redirect não é seguido', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: PHONE }), { status: 200 }));
    const port = createBootstrapGraphPort(fetchImpl as unknown as typeof fetch);
    const result = await port.get(PHONE, { fields: 'id,display_phone_number' }, TOKEN);
    expect(result).toEqual({ ok: true, body: { id: PHONE } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`https://graph.facebook.com/v26.0/${PHONE}?fields=id%2Cdisplay_phone_number`);
    expect(String(url)).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(JSON.stringify(init.body ?? null)).not.toContain(TOKEN);
  });

  it('redirect (fetch com redirect:error rejeita) → ok:false sem detalhes', async () => {
    const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
      if (init.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
      return new Response('{}', { status: 200 });
    });
    const result = await createBootstrapGraphPort(fetchImpl as unknown as typeof fetch).get(PHONE, {}, TOKEN);
    expect(result).toEqual({ ok: false, httpStatus: null, graphCode: null });
  });

  it('erro Graph → só status HTTP e código numérico, nunca a mensagem/corpo bruto', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 190, message: `token ${TOKEN} expired`, type: 'OAuthException', fbtrace_id: 'abc' } }), { status: 401 },
    ));
    const result = await createBootstrapGraphPort(fetchImpl as unknown as typeof fetch).get(PHONE, {}, TOKEN);
    expect(result).toEqual({ ok: false, httpStatus: 401, graphCode: 190 });
  });

  it('falha de rede → ok:false sem detalhes', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`boom ${TOKEN}`); });
    const result = await createBootstrapGraphPort(fetchImpl as unknown as typeof fetch).get(PHONE, {}, TOKEN);
    expect(result).toEqual({ ok: false, httpStatus: null, graphCode: null });
  });
});

describe('garantias estáticas', () => {
  it('Supabase: só as RPCs/tabelas previstas; nenhuma escrita direta; nada escreve em whatsapp_webhook_events', () => {
    const rpcs = [...CORE_SOURCE.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(rpcs).toEqual([
      'whatsapp_connection_lookup_for_processing', 'whatsapp_connection_owner_by_phone_number', 'whatsapp_connection_upsert',
    ]);
    const tables = [...CORE_SOURCE.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(['companies', 'profiles', 'whatsapp_webhook_events']);
    expect(CORE_SOURCE).toMatch(/\.from\('whatsapp_webhook_events'\)\.select\('id'\)\.limit\(1\)/);
    expect(CORE_SOURCE).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(CORE_SOURCE).not.toContain('whatsapp_webhook_event_register');
  });

  it('crypto não é duplicada: nenhuma cifra/AAD própria no script', () => {
    const code = CORE_SOURCE.replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['createCipheriv', 'createDecipheriv', 'aes-256-gcm', 'whatsapp-access-token:', 'sealAeadEnvelope', 'openAeadEnvelope']) {
      expect(code).not.toContain(forbidden);
    }
    expect(CORE_SOURCE).toContain("from '@/lib/server/whatsapp-connection/connection-persistence'");
    expect(CORE_SOURCE).toContain('decryptWhatsAppAccessToken');
  });

  it('ingestão não é alterada nem lida; nenhum .env é carregado', () => {
    for (const source of [CORE_SOURCE, ENTRY_SOURCE, LAUNCHER_SOURCE]) {
      expect(source).not.toContain('WHATSAPP_INGESTION_ENABLED');
      expect(source).not.toContain('whatsapp-webhook/ingestion');
      expect(source).not.toMatch(/dotenv|--env-file|loadEnvConfig/);
    }
  });

  it('launcher PowerShell: sem parâmetros, segredos via SecureString, ZeroFreeBSTR, dry-run antes do write, limpeza no finally', () => {
    expect(LAUNCHER_SOURCE).toMatch(/^\[CmdletBinding\(\)\]\r?\nparam\(\)\r?$/m);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(LAUNCHER_SOURCE)).toBe(true);
    expect(LAUNCHER_SOURCE).toContain('Read-Host -AsSecureString');
    for (const name of ['WA_BOOTSTRAP_ACCESS_TOKEN', 'WA_BOOTSTRAP_SERVICE_ROLE_KEY', 'WA_BOOTSTRAP_ENCRYPTION_KEY']) {
      expect(LAUNCHER_SOURCE).toContain(`Set-WaSecretEnv -Name '${name}'`);
      expect(LAUNCHER_SOURCE).not.toContain(`$env:${name}`);
    }
    expect(LAUNCHER_SOURCE).toContain('ZeroFreeBSTR($bstr)');
    expect(LAUNCHER_SOURCE).toContain("'WA_BOOTSTRAP_CONFIRM', 'TEST_COMPANY_ONLY'");
    expect(LAUNCHER_SOURCE).toContain('npm.cmd run --silent whatsapp:bootstrap-test-connection');
    expect(LAUNCHER_SOURCE.indexOf("-Mode 'dry-run'")).toBeLessThan(LAUNCHER_SOURCE.indexOf("-Mode 'write'"));
    expect(LAUNCHER_SOURCE).toMatch(/\} finally \{\r?\n\s+Clear-WaBootstrapEnv/);
    expect(LAUNCHER_SOURCE).not.toMatch(/Write-(Host|Output)[^\r\n]*\$env:/);
    expect(LAUNCHER_SOURCE).not.toMatch(/Start-Transcript/);
  });

  it('nenhum arquivo de app/, lib/ ou components/ importa scripts/', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(name) && /(from\s+|import\(\s*|require\(\s*)['"](@\/scripts\/|(\.\.\/)+scripts\/)/.test(readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    for (const dir of ['app', 'lib', 'components']) {
      try {
        if (statSync(join(ROOT, dir)).isDirectory()) walk(join(ROOT, dir));
      } catch {
        // diretório ausente
      }
    }
    expect(offenders).toEqual([]);
  });
});
