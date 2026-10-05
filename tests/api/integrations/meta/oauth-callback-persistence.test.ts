// META-P4B — callback com persistência real (review_ui + flag ON). A porta RPC
// é mockada (sem Supabase). Tokens, chaves e ciphertexts são FAKE.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const port = {
    upsert: vi.fn(),
    ownerByPage: vi.fn(),
  };
  return { port, createPort: vi.fn(() => port) };
});

vi.mock('@/lib/server/meta-oauth/connection-rpc', () => ({
  createMetaConnectionRpcPort: mocks.createPort,
}));

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';
import { verifyReviewResultToken } from '@/lib/server/meta-oauth/review-result';
import { decryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';
import {
  META_TEST_COMPANY_ID,
  META_TEST_PAGE_ID,
  REQUIRED_LEADGEN_PAGE_TASK,
} from '@/lib/server/meta-oauth/config';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const ENCRYPTION_KEY_HEX = 'ab'.repeat(32);
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
const APP_URL = 'https://crm.assessoriakapa.com.br';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/callback`;
const GRAPH_VERSION = 'v26.0';
const FAKE_CODE = 'AQ' + 'x'.repeat(60);
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PILOT_COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER_TEST_RIVAL = '33333333-3333-4333-8333-333333333333';
const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real-000000000000';
const FAKE_SUAT = 'FAKE-SUAT-TOKEN-persistence-test-only';
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-TOKEN-persistence-test-only';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];

let fetchMock: ReturnType<typeof vi.spyOn>;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function urlOf(arg: unknown): URL {
  return arg instanceof URL ? arg : new URL(String(arg));
}

function callsFor(suffix: string, method?: string): Array<{ url: URL; method: string }> {
  return fetchMock.mock.calls
    .map((c) => ({ url: urlOf(c[0]), method: String((c[1] as RequestInit | undefined)?.method ?? 'GET') }))
    .filter((c) => c.url.pathname.endsWith(suffix) && (method === undefined || c.method === method));
}

function stateFor(opts: { flow?: 'review_ui'; companyId?: string } = {}): string {
  return createOAuthState({
    secret: SECRET_BUF,
    binding: BINDING,
    userId: USER_ID,
    companyId: opts.companyId ?? META_TEST_COMPANY_ID,
    ...(opts.flow ? { flow: opts.flow } : {}),
  });
}

function callbackRequest(state: string): Request {
  const url = new URL(ENDPOINT);
  url.searchParams.set('code', FAKE_CODE);
  url.searchParams.set('state', state);
  return new Request(url, { method: 'GET', headers: { cookie: `${BINDING_COOKIE_NAME}=${BINDING}` } });
}

function reviewTokenFrom(res: Response): string {
  return new URL(res.headers.get('location') ?? '').searchParams.get('meta_review') ?? '';
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'a1000000-0000-4000-8000-000000000001',
    company_id: META_TEST_COMPANY_ID,
    page_id: META_TEST_PAGE_ID,
    page_name: 'KAPA CRM Teste',
    status: 'connected',
    connected_at: '2026-10-05T12:00:00.000Z',
    leadgen_subscribed_at: '2026-10-05T12:00:01.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_GRAPH_API_VERSION', GRAPH_VERSION);
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
  vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', ENCRYPTION_KEY_HEX);

  mocks.port.upsert.mockReset().mockResolvedValue({ data: [row()], error: null });
  mocks.port.ownerByPage.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.createPort.mockClear();

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const u = urlOf(input);
    if (u.pathname.endsWith('/oauth/access_token')) {
      return json({ access_token: FAKE_SUAT, token_type: 'bearer', expires_in: 5183944 });
    }
    if (u.pathname.endsWith('/me/permissions')) {
      return json({ data: REQUIRED.map((permission) => ({ permission, status: 'granted' })) });
    }
    if (u.pathname.endsWith('/me/accounts')) {
      return json({
        data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: [REQUIRED_LEADGEN_PAGE_TASK] }],
      });
    }
    if (u.pathname.endsWith('/subscribed_apps')) return json({ success: true });
    if (u.pathname.endsWith('/posts')) return json({ data: [] });
    throw new Error(`unexpected fetch in test: ${u.toString()}`);
  });

  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('flag OFF — regressão crítica: zero persistência, zero owner, zero RPC', () => {
  it('META_CONNECTION_PERSISTENCE_ENABLED=false: fluxo review atual, sucesso sem persistência', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(res.status).toBe(302);
    expect(mocks.createPort).not.toHaveBeenCalled();
    expect(mocks.port.ownerByPage).not.toHaveBeenCalled();
    expect(mocks.port.upsert).not.toHaveBeenCalled();
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.outcome).toBe('success');
    expect(payload.ok && payload.payload.persisted).toBe(false);
    expect(callsFor('/subscribed_apps', 'POST')).toHaveLength(1);
  });

  it('flag ausente (default) também não persiste', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', '');
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(res.status).toBe(302);
    expect(mocks.port.upsert).not.toHaveBeenCalled();
  });
});

describe('flag ON + review_ui — sucesso e conteúdo da RPC', () => {
  it('flag ON + sucesso: upsert uma vez, redirect de sucesso com persisted=true', async () => {
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(res.status).toBe(302);
    expect(mocks.port.upsert).toHaveBeenCalledTimes(1);
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.outcome).toBe('success');
    expect(payload.ok && payload.payload.persisted).toBe(true);
  });

  it('RPC recebe company, page, pageName, quatro permissões, connectedBy, timestamps e key version 1', async () => {
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const args = mocks.port.upsert.mock.calls[0][0];
    expect(args.p_company_id).toBe(META_TEST_COMPANY_ID);
    expect(args.p_page_id).toBe(META_TEST_PAGE_ID);
    expect(args.p_page_name).toBe('KAPA CRM Teste');
    expect([...args.p_granted_scopes].sort()).toEqual([...REQUIRED].sort());
    expect(args.p_connected_by).toBe(USER_ID);
    expect(args.p_token_key_version).toBe(1);
    expect(new Date(args.p_connected_at).toString()).not.toBe('Invalid Date');
    expect(new Date(args.p_leadgen_subscribed_at).toString()).not.toBe('Invalid Date');
  });

  it('plaintext nunca aparece nos argumentos da RPC; o ciphertext decifra só com company+page corretos', async () => {
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const args = mocks.port.upsert.mock.calls[0][0];
    expect(JSON.stringify(args)).not.toContain(FAKE_PAGE_TOKEN);
    expect(args.p_access_token_ciphertext.startsWith('v1.')).toBe(true);
    expect(
      decryptMetaPageToken({ ciphertext: args.p_access_token_ciphertext, companyId: META_TEST_COMPANY_ID, pageId: META_TEST_PAGE_ID, key: ENCRYPTION_KEY }),
    ).toBe(FAKE_PAGE_TOKEN);
  });

  it('subscribe acontece antes do upsert (nenhuma persistência antes do subscribe)', async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const u = urlOf(input);
      if (u.pathname.endsWith('/subscribed_apps')) order.push('subscribe');
      if (u.pathname.endsWith('/oauth/access_token')) return json({ access_token: FAKE_SUAT, token_type: 'bearer', expires_in: 5183944 });
      if (u.pathname.endsWith('/me/permissions')) return json({ data: REQUIRED.map((permission) => ({ permission, status: 'granted' })) });
      if (u.pathname.endsWith('/me/accounts')) return json({ data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: [REQUIRED_LEADGEN_PAGE_TASK] }] });
      if (u.pathname.endsWith('/posts')) return json({ data: [] });
      if (u.pathname.endsWith('/subscribed_apps')) return json({ success: true });
      void init;
      throw new Error('unexpected');
    });
    mocks.port.upsert.mockImplementation(async () => {
      order.push('upsert');
      return { data: [row()], error: null };
    });
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(order).toEqual(['subscribe', 'upsert']);
  });

  it('owner vazio segue normalmente', async () => {
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(res.status).toBe(302);
    expect(mocks.port.ownerByPage).toHaveBeenCalledWith(META_TEST_PAGE_ID);
  });

  it('owner da mesma company é reconexão válida e segue', async () => {
    mocks.port.ownerByPage.mockResolvedValue({
      data: [{ integration_id: 'a1000000-0000-4000-8000-000000000001', company_id: META_TEST_COMPANY_ID, page_id: META_TEST_PAGE_ID, status: 'connected' }],
      error: null,
    });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.persisted).toBe(true);
    expect(mocks.port.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('ownership — conflito de outra company para ANTES de qualquer side-effect Meta', () => {
  it('owner de outra company: falha page_already_connected e subscribe nunca é chamado', async () => {
    mocks.port.ownerByPage.mockResolvedValue({
      data: [{ integration_id: 'a1000000-0000-4000-8000-000000000001', company_id: OTHER_TEST_RIVAL, page_id: META_TEST_PAGE_ID, status: 'connected' }],
      error: null,
    });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(res.status).toBe(302);
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.outcome).toBe('failure');
    expect(payload.ok && payload.payload.failureCode).toBe('page_already_connected');
    expect(callsFor('/subscribed_apps')).toHaveLength(0);
    expect(mocks.port.upsert).not.toHaveBeenCalled();
    expect(res.headers.get('location')).not.toContain(OTHER_TEST_RIVAL);
  });

  it('falha do owner lookup (transporte, duas tentativas) -> persistence_unavailable, sem subscribe', async () => {
    mocks.port.ownerByPage.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('persistence_unavailable');
    expect(mocks.port.ownerByPage).toHaveBeenCalledTimes(2);
    expect(callsFor('/subscribed_apps')).toHaveLength(0);
  });
});

describe('falhas de persistência — sem retry semântico, sem unsubscribe', () => {
  it('upsert page_already_connected (corrida): sanitizado, subscribe já feito, NENHUM unsubscribe', async () => {
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('page_already_connected');
    expect(mocks.port.upsert).toHaveBeenCalledTimes(1);
    expect(callsFor('/subscribed_apps', 'POST')).toHaveLength(1);
    expect(callsFor('/subscribed_apps', 'DELETE')).toHaveLength(0);
  });

  it('upsert com erro de transporte: no máximo duas tentativas -> persistence_unavailable, sem unsubscribe', async () => {
    mocks.port.upsert.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(mocks.port.upsert).toHaveBeenCalledTimes(2);
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('persistence_unavailable');
    expect(callsFor('/subscribed_apps', 'DELETE')).toHaveLength(0);
  });

  it('erro semântico (invalid_input) não é repetido', async () => {
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(mocks.port.upsert).toHaveBeenCalledTimes(1);
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('invalid_persistence_input');
  });

  it('erro SQL bruto não aparece no redirect nem no token', async () => {
    mocks.port.upsert.mockResolvedValue({
      data: null,
      error: { code: '23503', message: 'violates foreign key DETAIL: Key (connected_by)=(x) SECRET-SQL' },
    });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('SECRET-SQL');
    expect(location).not.toContain('DETAIL');
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('connection_persist_failed');
  });

  it('chave de cifragem ausente: token_encryption_failed, zero RPC, sem unsubscribe', async () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('token_encryption_failed');
    expect(mocks.port.upsert).not.toHaveBeenCalled();
    expect(callsFor('/subscribed_apps', 'DELETE')).toHaveLength(0);
  });

  it('falha ao criar a porta (admin client mal configurado) -> persistence_unavailable, zero RPC', async () => {
    mocks.createPort.mockImplementationOnce(() => {
      throw new Error('supabase_admin_client_misconfigured');
    });
    const res = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const payload = verifyReviewResultToken(reviewTokenFrom(res), { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(payload.ok && payload.payload.failureCode).toBe('persistence_unavailable');
    expect(mocks.port.upsert).not.toHaveBeenCalled();
  });
});

describe('isolamento — pilotos e fluxos sem review nunca persistem', () => {
  it('piloto (company comum) com flag ON: zero porta, zero owner, zero RPC, resposta JSON sem ciphertext', async () => {
    const res = await GET(callbackRequest(stateFor({ companyId: PILOT_COMPANY })));
    expect(res.status).toBe(200);
    expect(mocks.createPort).not.toHaveBeenCalled();
    expect(mocks.port.upsert).not.toHaveBeenCalled();
    expect(await res.text()).not.toMatch(/v1\.|access_token|ciphertext/);
  });

  it('fluxo test-company SEM flow=review_ui com flag ON: nunca persiste', async () => {
    const res = await GET(callbackRequest(stateFor({})));
    expect(res.status).toBe(200);
    expect(mocks.createPort).not.toHaveBeenCalled();
    expect(mocks.port.upsert).not.toHaveBeenCalled();
  });
});

describe('segurança do token de review, cookie e logs', () => {
  it('token de sucesso e de falha não contêm segredos', async () => {
    const ok = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    const fail = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    for (const res of [ok, fail]) {
      const location = res.headers.get('location') ?? '';
      expect(location).not.toContain(FAKE_PAGE_TOKEN);
      expect(location).not.toContain(FAKE_SUAT);
      expect(location).not.toContain(ENCRYPTION_KEY_HEX);
      expect(location).not.toMatch(/v1\./);
    }
  });

  it('cookie de binding é limpo em sucesso e em falha', async () => {
    const ok = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    const fail = await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    expect(ok.headers.get('set-cookie')).toContain(BINDING_COOKIE_NAME);
    expect(fail.headers.get('set-cookie')).toContain(BINDING_COOKIE_NAME);
  });

  it('nenhum console.* contém token, ciphertext ou chave em sucesso ou falha', async () => {
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls).map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(FAKE_PAGE_TOKEN);
    expect(logged).not.toContain(FAKE_SUAT);
    expect(logged).not.toContain(ENCRYPTION_KEY_HEX);
    expect(logged).not.toContain('v1.');
  });

  it('nenhum log contém o Page ID real da Página de teste, em sucesso ou em falha', async () => {
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    mocks.port.upsert.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    await GET(callbackRequest(stateFor({ flow: 'review_ui' })));
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls).map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(META_TEST_PAGE_ID);
    expect(logged).toContain('persistence_failed');
  });
});
