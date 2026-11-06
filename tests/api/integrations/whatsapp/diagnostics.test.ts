// tests/api/integrations/whatsapp/diagnostics.test.ts — W2B-2. Rota GET
// /api/integrations/whatsapp/diagnostics: acesso, isolamento, sanitização e
// ausência de vazamento. Auth e Supabase mockados; sem rede, sem Meta, sem banco.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedActor: vi.fn(),
  adminRpc: vi.fn(),
}));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});
vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import * as route from '@/app/api/integrations/whatsapp/diagnostics/route';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
import { fetchWhatsAppConnectionHealth } from '@/lib/server/whatsapp-connection/connection-rpc';

const { GET } = route;

const ENDPOINT = 'https://crm.example.test/api/integrations/whatsapp/diagnostics';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const COMMIT_SHA = '4b59e4ba26a185e08a51883a3a3733f076d5970c';

const VERIFY_TOKEN = 'SENTINEL-VERIFY-TOKEN-must-not-leak';
const APP_SECRET = 'SENTINEL-APP-SECRET-must-not-leak';
const ENCRYPTION_KEY = 'ab'.repeat(32);
const CONTENT_KEY = 'cd'.repeat(32);
const HMAC_KEY = 'ef'.repeat(32);
const WABA_ID = '918273645546372';
const PHONE_NUMBER_ID = '564738291056473';
const DISPLAY_PHONE = '+55 11 91234-5678';

function connectionRow(over: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    company_id: META_TEST_COMPANY_ID,
    waba_id: WABA_ID,
    phone_number_id: PHONE_NUMBER_ID,
    display_phone_number: DISPLAY_PHONE,
    status: 'connected',
    connected_at: '2026-11-04T20:42:29.164+00:00',
    disconnected_at: null,
    last_error_code: null,
    last_error_at: null,
    updated_at: '2026-11-04T20:42:31.169+00:00',
    ...over,
  };
}

function actor(opts: { isSuperAdmin?: unknown; err?: unknown } = {}) {
  return {
    ok: true as const,
    actor: { profileId: 'u' },
    jwt: 'fake.jwt',
    client: {
      rpc: vi.fn((name: string) => {
        if (name === 'is_platform_super_admin') {
          return Promise.resolve({ data: 'isSuperAdmin' in opts ? opts.isSuperAdmin : true, error: opts.err ?? null });
        }
        throw new Error(`unexpected rpc: ${name}`);
      }),
    },
  };
}

const request = (query = '') => new Request(`${ENDPOINT}${query}`, { method: 'GET' });

const summaryRow = {
  out_events_total: 6,
  out_events_received: 1,
  out_events_processed: 4,
  out_events_failed: 0,
  out_events_waba_mismatch: 0,
  out_events_contact_unresolved: 0,
  out_events_group_message: 0,
  out_last_event_at: '2026-11-05T10:00:00+00:00',
  out_messages_total: 4,
  out_contacts_total: 2,
  out_conversations_total: 2,
  out_capture_enabled_connections: 0,
};

// Por padrão, a RPC de resumo ainda não existe no banco, como hoje em produção.
function arrangeRpc(opts: { status?: unknown; summary?: unknown } = {}) {
  mocks.adminRpc.mockImplementation(async (name: string) => {
    if (name === 'whatsapp_connection_status') return opts.status ?? { data: [connectionRow()], error: null };
    if (name === 'whatsapp_diagnostics_summary') {
      return opts.summary ?? { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    }
    throw new Error(`unexpected rpc: ${name}`);
  });
}

const statusCalls = () => mocks.adminRpc.mock.calls.filter((call) => call[0] === 'whatsapp_connection_status');

let fetchSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', VERIFY_TOKEN);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', ENCRYPTION_KEY);
  vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', CONTENT_KEY);
  vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', HMAC_KEY);
  vi.stubEnv('WHATSAPP_INGESTION_ENABLED', undefined as unknown as string);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT_SHA);

  mocks.requireAuthenticatedActor.mockResolvedValue(actor());
  arrangeRpc();

  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
  mocks.adminRpc.mockReset();
});

function everythingSerialized(body: unknown): string {
  const logs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
  return `${JSON.stringify(body)}\n${logs}`;
}

describe('GET /api/integrations/whatsapp/diagnostics — acesso', () => {
  it.each([
    ['sem header', undefined],
    ['esquema errado', 'Basic abc123'],
    ['Bearer vazio', 'Bearer '],
  ])('validador real, %s → 401, sem rede e sem consultar conexão', async (_label, authorization) => {
    const { requireAuthenticatedActor } = await vi.importActual<typeof import('@/lib/server/invites/http')>(
      '@/lib/server/invites/http',
    );
    mocks.requireAuthenticatedActor.mockImplementation(requireAuthenticatedActor);
    const headers = authorization ? { authorization } : undefined;
    const res = await GET(new Request(ENDPOINT, { method: 'GET', headers }));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('não autenticado → 401, sem consultar conexão', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['Admin', false],
    ['Manager', false],
    ['Seller', false],
    ['perfil inativo (RPC devolve null)', null],
    ['resposta não booleana', 'true'],
  ])('%s → 403, sem consultar conexão', async (_label, isSuperAdmin) => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor({ isSuperAdmin }));
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('falha ao checar Super Admin → 500 sem detalhe, sem consultar conexão', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor({ isSuperAdmin: null, err: { message: 'db detail secret' } }));
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'server_misconfigured' });
    expect(everythingSerialized(body)).not.toContain('db detail secret');
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('a permissão vem do RPC no client do próprio usuário, não do service_role', async () => {
    const current = actor();
    mocks.requireAuthenticatedActor.mockResolvedValue(current);
    await GET(request());
    expect(current.client.rpc).toHaveBeenCalledWith('is_platform_super_admin');
    expect(mocks.adminRpc).not.toHaveBeenCalledWith('is_platform_super_admin', expect.anything());
  });
});

describe('GET /api/integrations/whatsapp/diagnostics — isolamento', () => {
  it('Super Admin pedindo outra empresa → 403, sem consultar conexão', async () => {
    const res = await GET(request(`?company_id=${OTHER_COMPANY_ID}`));
    expect(res.status).toBe(403);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('company_id inválido → 400, sem consultar conexão', async () => {
    const res = await GET(request('?company_id=nao-e-uuid'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_request' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['sem company_id', ''],
    ['com a TEST COMPANY', `?company_id=${META_TEST_COMPANY_ID}`],
    ['com a TEST COMPANY em maiúsculas', `?company_id=${META_TEST_COMPANY_ID.toUpperCase()}`],
  ])('%s → consulta só a TEST COMPANY, uma vez, pela RPC de status', async (_label, query) => {
    const res = await GET(request(query));
    expect(res.status).toBe(200);
    expect(statusCalls()).toEqual([['whatsapp_connection_status', { p_company_id: META_TEST_COMPANY_ID }]]);
    expect(mocks.adminRpc).toHaveBeenCalledWith('whatsapp_diagnostics_summary', { p_company_id: META_TEST_COMPANY_ID });
    expect(mocks.adminRpc).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/integrations/whatsapp/diagnostics — relatório', () => {
  it('estado atual de produção: flag ausente, sem resumo, inscrição não confirmada', async () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', '');
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', '');
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      integrationStatus: 'awaiting_waba_confirmation',
      ingestion: 'disabled',
      config: { webhookVerifyToken: true, appSecret: true, tokenEncryptionKey: true },
      connection: { state: 'connected', count: 1, connectedAt: '2026-11-04T20:42:29.164Z', lastErrorCode: null },
      capture: { enabledConnections: null, contentEncryptionKey: false, contactHmacKey: false },
      events: { availability: 'unavailable', count: null },
      wabaSubscription: 'not_confirmed',
      deployment: { environment: 'production', commitSha: '4b59e4b' },
      warnings: [],
    });
  });

  it.each([
    ['false', 'disabled'],
    ['TRUE', 'disabled'],
    ['1', 'disabled'],
    ['true', 'enabled'],
  ])('flag "%s" → %s, sem devolver o valor bruto', async (raw, expected) => {
    vi.stubEnv('WHATSAPP_INGESTION_ENABLED', raw);
    const body = await (await GET(request())).json();
    expect(body.ingestion).toBe(expected);
    expect(body.warnings).toEqual(expected === 'enabled' ? ['ingestion_enabled'] : []);
  });

  it('nunca declara a inscrição como confirmada nem sucesso, mesmo com tudo ok e flag ON', async () => {
    vi.stubEnv('WHATSAPP_INGESTION_ENABLED', 'true');
    const body = await (await GET(request())).json();
    expect(body.wabaSubscription).toBe('not_confirmed');
    expect(body.integrationStatus).toBe('awaiting_waba_confirmation');
  });

  it('sem RPC de resumo no banco, eventos ficam indisponíveis, nunca 0', async () => {
    const body = await (await GET(request())).json();
    expect(body.events).toEqual({ availability: 'unavailable', count: null });
    expect(body.capture.enabledConnections).toBeNull();
    expect(JSON.stringify(body)).not.toContain('function not found');
  });

  it('com a RPC aplicada, devolve só contagens e data', async () => {
    arrangeRpc({ summary: { data: [summaryRow], error: null } });
    const body = await (await GET(request())).json();
    expect(body.events).toEqual({
      availability: 'available', count: 6, pending: 1, failed: 0, messages: 4, lastEventAt: '2026-11-05T10:00:00.000Z',
      refused: { wabaMismatch: 0, contactUnresolved: 0, groupMessage: 0 },
    });
    expect(body.capture.enabledConnections).toBe(0);
    expect(body.warnings).toEqual([]);
  });

  it('recusas aparecem como contagens e geram alerta, sem IDs', async () => {
    arrangeRpc({
      summary: {
        data: [{ ...summaryRow, out_events_failed: 6, out_events_waba_mismatch: 3, out_events_contact_unresolved: 2, out_events_group_message: 1 }],
        error: null,
      },
    });
    const body = await (await GET(request())).json();
    expect(body.events.refused).toEqual({ wabaMismatch: 3, contactUnresolved: 2, groupMessage: 1 });
    expect(body.warnings).toEqual(['messages_refused']);
    const output = everythingSerialized(body);
    for (const secret of [WABA_ID, PHONE_NUMBER_ID, DISPLAY_PHONE]) expect(output).not.toContain(secret);
  });

  it('exceção na RPC de resumo não derruba o diagnóstico', async () => {
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === 'whatsapp_connection_status') return { data: [connectionRow()], error: null };
      throw new Error('rpc detail secret');
    });
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events.availability).toBe('unavailable');
    expect(everythingSerialized(body)).not.toContain('rpc detail secret');
  });

  it('captura habilitada sem chaves válidas gera alerta', async () => {
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', 'curta');
    arrangeRpc({ summary: { data: [{ ...summaryRow, out_capture_enabled_connections: 1 }], error: null } });
    const body = await (await GET(request())).json();
    expect(body.warnings).toEqual(['capture_keys_invalid']);
    expect(body.capture).toEqual({ enabledConnections: 1, contentEncryptionKey: true, contactHmacKey: false });
  });

  it('chaves ausentes sem captura habilitada não geram alerta nem misconfigured', async () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', '');
    const body = await (await GET(request())).json();
    expect(body.warnings).toEqual([]);
    expect(body.integrationStatus).toBe('awaiting_waba_confirmation');
  });

  it.each([
    ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', '', 'webhookVerifyToken'],
    ['META_APP_SECRET', '   ', 'appSecret'],
    ['WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', '', 'tokenEncryptionKey'],
    ['WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', 'AB'.repeat(32), 'tokenEncryptionKey'],
    ['WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', 'ab'.repeat(31), 'tokenEncryptionKey'],
  ])('%s inválida → misconfigured, sem expor valor', async (name, value, field) => {
    vi.stubEnv(name, value);
    const body = await (await GET(request())).json();
    expect(body.config[field]).toBe(false);
    expect(body.integrationStatus).toBe('misconfigured');
  });

  it.each([
    ['nenhuma conexão', [], 'absent', 0],
    ['duas conexões', [connectionRow(), connectionRow()], 'multiple', 2],
    ['desconectada', [connectionRow({ status: 'disconnected' })], 'disconnected', 1],
    ['com erro', [connectionRow({ status: 'error', last_error_code: 'token_invalid' })], 'error', 1],
  ])('%s → connection_not_ready', async (_label, rows, state, count) => {
    arrangeRpc({ status: { data: rows, error: null } });
    const body = await (await GET(request())).json();
    expect(body.connection.state).toBe(state);
    expect(body.connection.count).toBe(count);
    expect(body.integrationStatus).toBe('connection_not_ready');
  });

  it('código de erro fora do formato é descartado', async () => {
    arrangeRpc({ status: { data: [connectionRow({ status: 'error', last_error_code: 'Bearer token-vazado' })], error: null } });
    const body = await (await GET(request())).json();
    expect(body.connection.lastErrorCode).toBeNull();
  });

  it.each([
    ['erro da RPC', () => arrangeRpc({ status: { data: null, error: { code: '42501', message: 'rpc detail secret' } } })],
    ['exceção', () => mocks.adminRpc.mockRejectedValue(new Error('rpc detail secret'))],
  ])('%s → 200 com conexão indisponível, sem detalhe', async (_label, arrange) => {
    arrange();
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.connection).toEqual({ state: 'unavailable', count: null, connectedAt: null, lastErrorCode: null });
    expect(body.integrationStatus).toBe('unavailable');
    expect(everythingSerialized(body)).not.toContain('rpc detail secret');
  });

  it.each([
    ['ausentes', undefined, undefined, null, null],
    ['SHA malformado', 'production', 'nao-e-um-sha', 'production', null],
    ['ambiente desconhecido', 'staging', COMMIT_SHA, null, '4b59e4b'],
  ])('deployment com dados %s → só o que for confiável', async (_label, env, sha, environment, commitSha) => {
    vi.stubEnv('VERCEL_ENV', env as unknown as string);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha as unknown as string);
    const body = await (await GET(request())).json();
    expect(body.deployment).toEqual({ environment, commitSha });
  });
});

describe('GET /api/integrations/whatsapp/diagnostics — ausência de vazamento', () => {
  it('o adaptador descarta WABA, número e número exibido já na leitura', async () => {
    const { data } = await fetchWhatsAppConnectionHealth(META_TEST_COMPANY_ID);
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([
      'connected_at',
      'disconnected_at',
      'last_error_code',
      'status',
    ]);
  });

  it('nada sensível na resposta nem nos logs', async () => {
    const body = await (await GET(request())).json();
    const output = everythingSerialized(body);
    for (const secret of [
      VERIFY_TOKEN,
      APP_SECRET,
      ENCRYPTION_KEY,
      CONTENT_KEY,
      HMAC_KEY,
      WABA_ID,
      PHONE_NUMBER_ID,
      DISPLAY_PHONE,
      'fake.jwt',
      '33333333-3333-4333-8333-333333333333',
      META_TEST_COMPANY_ID,
      COMMIT_SHA,
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('o log traz só as chaves permitidas', async () => {
    await GET(request());
    const [, payload] = logSpy.mock.calls.find((call) => call[0] === '[whatsapp-diagnostics]') as [string, string];
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(['durationMs', 'operation', 'requestId', 'result']);
  });

  it('não faz chamada de rede: nenhuma Graph, nenhuma mensagem', async () => {
    await GET(request());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a rota só exporta GET: nenhum método de escrita', () => {
    expect(Object.keys(route).filter((key) => /^(POST|PUT|PATCH|DELETE)$/.test(key))).toEqual([]);
  });

  it('o código não usa RPCs de ciphertext/escrita, Graph ou decifragem', () => {
    const root = process.cwd();
    for (const file of ['app/api/integrations/whatsapp/diagnostics/route.ts', 'lib/server/whatsapp-connection/diagnostics.ts']) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/lookup_for_processing|whatsapp_connection_upsert|event_register|set_capture|message_capture|graph\.facebook|decryptWhatsApp|persistWhatsApp/);
    }
  });
});
