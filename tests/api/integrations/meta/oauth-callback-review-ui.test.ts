// tests/api/integrations/meta/oauth-callback-review-ui.test.ts —
// META-OAUTH-REVIEW-UI. Cobre o ÚNICO desvio de comportamento do callback:
// quando (e SÓ quando) `state.f === "review_ui"` E o resultado chega a
// `test_page_permissions_verified`, a rota devolve um 302 para a SPA
// (Ajustes > Integrações) com um token de resultado efêmero e assinado na
// querystring, em vez do JSON de sempre. Qualquer outro caso (sem o flag,
// ou com o flag mas SEM chegar ao sucesso completo) continua exatamente
// como antes — coberto por oauth-callback.test.ts e
// oauth-callback-page-subscription.test.ts, que não mudam.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';
import { verifyReviewResultToken } from '@/lib/server/meta-oauth/review-result';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';
import { META_TEST_COMPANY_ID, META_TEST_PAGE_ID, REQUIRED_LEADGEN_PAGE_TASK } from '@/lib/server/meta-oauth/config';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const APP_URL = 'https://crm.assessoriakapa.com.br';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/callback`;
const GRAPH_VERSION = 'v26.0';
const FAKE_CODE = 'AQ' + 'x'.repeat(60);
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real-000000000000';
const FAKE_SUAT = 'FAKE-SUAT-TOKEN-must-never-leak-000';
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-ACCESS-TOKEN-must-never-leak-111';

let fetchMock: ReturnType<typeof vi.spyOn>;

function tokenOkResponse(): Response {
  return new Response(JSON.stringify({ access_token: FAKE_SUAT, token_type: 'bearer', expires_in: 5183944 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function accountsOkResponse(overrides?: { data?: unknown[] }): Response {
  const data = overrides?.data ?? [
    { id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: [REQUIRED_LEADGEN_PAGE_TASK] },
  ];
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function readEngagementOkResponse(): Response {
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function subscribeOkResponse(): Response {
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function urlOf(arg: unknown): URL {
  return arg instanceof URL ? arg : new URL(String(arg));
}

let accountsResponse: () => Response = () => accountsOkResponse();

const REQUIRED_GRANTED_PERMISSIONS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
function permissionsOkResponse(permissions: Array<{ permission: string; status: string }> = REQUIRED_GRANTED_PERMISSIONS.map((permission) => ({ permission, status: 'granted' }))): Response {
  return new Response(JSON.stringify({ data: permissions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
let permissionsResponse: () => Response = () => permissionsOkResponse();


function stateFor(opts: { flow?: 'review_ui'; companyId?: string; binding?: string }): string {
  return createOAuthState({
    secret: SECRET_BUF,
    binding: opts.binding ?? BINDING,
    userId: USER_ID,
    companyId: opts.companyId ?? META_TEST_COMPANY_ID,
    ...(opts.flow ? { flow: opts.flow } : {}),
  });
}

function callbackRequest(params: Record<string, string>, cookie?: string): Request {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  return new Request(url, { method: 'GET', headers });
}

function bindingCookie(value = BINDING): string {
  return `${BINDING_COOKIE_NAME}=${value}`;
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_GRAPH_API_VERSION', GRAPH_VERSION);
  vi.stubEnv('APP_URL', APP_URL);

  accountsResponse = () => accountsOkResponse();


  permissionsResponse = () => permissionsOkResponse();

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const u = urlOf(input);
    if (u.pathname.endsWith('/oauth/access_token')) return tokenOkResponse();

    if (u.pathname.endsWith('/me/permissions')) return permissionsResponse();
    if (u.pathname.endsWith('/me/accounts')) return accountsResponse();
    if (u.pathname.endsWith('/subscribed_apps')) return subscribeOkResponse();
    if (u.pathname === `/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`) return readEngagementOkResponse();
    throw new Error(`unexpected fetch in test: ${u.toString()}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback — redirect da UI de review (flow=review_ui)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  });

  it('flag OFF no momento do callback + state flow=review_ui -> NUNCA 302 (volta ao JSON de sempre)', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    expect(res.status).not.toBe(302);
    expect(res.headers.get('location')).toBeNull();
  });

  it('flow=review_ui + sucesso completo -> 302 para /company/<test-id> com meta_review assinado na URL; sem JSON, sem code/token', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).not.toBe('');
    const redirectUrl = new URL(location);
    expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe(`${APP_URL}/company/${META_TEST_COMPANY_ID}`);
    const token = redirectUrl.searchParams.get('meta_review');
    expect(typeof token).toBe('string');
    expect(token ?? '').not.toContain(FAKE_CODE);
    expect(token ?? '').not.toContain(FAKE_SUAT);
    expect(token ?? '').not.toContain(FAKE_PAGE_TOKEN);
    expect(token ?? '').not.toContain(STATE_SECRET_HEX);

    // corpo da resposta 302 não carrega nada sensível (nem vazio é obrigatório, mas nunca JSON de sucesso antigo)
    const text = await res.text();
    expect(text).not.toContain(FAKE_CODE);
    expect(text).not.toContain(FAKE_SUAT);
  });

  it('o token do redirect verifica com o mesmo segredo e aponta pra company de teste + stage correto', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    const redirectUrl = new URL(res.headers.get('location') ?? '');
    const token = redirectUrl.searchParams.get('meta_review') ?? '';
    const verified = verifyReviewResultToken(token, { secret: SECRET_BUF, expectedCompanyId: META_TEST_COMPANY_ID });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.stage).toBe('test_page_permissions_verified');
      expect(verified.payload.cid).toBe(META_TEST_COMPANY_ID);
    }
  });

  it('token do redirect é rejeitado se verificado contra outra company (context_mismatch)', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    const redirectUrl = new URL(res.headers.get('location') ?? '');
    const token = redirectUrl.searchParams.get('meta_review') ?? '';
    const verified = verifyReviewResultToken(token, { secret: SECRET_BUF, expectedCompanyId: '99999999-9999-4999-8999-999999999999' });
    expect(verified.ok).toBe(false);
  });

  it('302 limpa o cookie de binding (anti-replay), igual ao caminho JSON', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${BINDING_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(setCookie).toContain('HttpOnly');
  });

  it('SEM flow=review_ui (piloto normal), mesmo na company de teste: continua JSON, NUNCA 302', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({}) }, bindingCookie()));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    expect(body.stage).toBe('test_page_permissions_verified');
  });

  it('flow=review_ui mas a Page de teste NÃO tem a task ADVERTISE (falha ANTES do sucesso completo): continua JSON sanitizado, sem redirect', async () => {
    accountsResponse = () =>
      accountsOkResponse({ data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: ['MANAGE'] }] });
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
    expect((await res.json()).error).toBe('test_page_missing_advertise_task');
  });

  it('flow=review_ui + erro do provider (usuário negou) -> continua JSON sanitizado, sem redirect', async () => {
    const res = await GET(
      callbackRequest(
        { error: 'access_denied', error_reason: 'user_denied', state: stateFor({ flow: 'review_ui' }) },
        bindingCookie(),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect((await res.json()).error).toBe('provider_error');
  });

  it('logs do caminho review_ui nunca contêm code/token/segredo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()),
    );
    const redirectUrl = new URL(res.headers.get('location') ?? '');
    const token = redirectUrl.searchParams.get('meta_review') ?? '';
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(FAKE_CODE);
    expect(logged).not.toContain(FAKE_SUAT);
    expect(logged).not.toContain(FAKE_PAGE_TOKEN);
    expect(logged).not.toContain(STATE_SECRET_HEX);
    expect(logged).not.toContain(token);
    expect(logged).toContain('test_page_permissions_verified');
  });
});

describe('GET /api/integrations/meta/oauth/callback — permissões obrigatórias (leads_retrieval e demais)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  });

  function callsFor(suffix: string): URL[] {
    return fetchMock.mock.calls.map((c) => urlOf(c[0])).filter((u) => u.pathname.endsWith(suffix));
  }

  function grantedExcept(missing: string): Array<{ permission: string; status: string }> {
    return REQUIRED_GRANTED_PERMISSIONS.filter((p) => p !== missing).map((permission) => ({ permission, status: 'granted' }));
  }

  it('leads_retrieval ausente -> 403 missing_required_permission com o nome; nenhuma chamada à Page; sem redirect', async () => {
    permissionsResponse = () => permissionsOkResponse(grantedExcept('leads_retrieval'));
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'missing_required_permission', permission: 'leads_retrieval' });
    expect(res.headers.get('location')).toBeNull();
    expect(callsFor('/me/accounts')).toHaveLength(0);
    expect(callsFor('/subscribed_apps')).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(FAKE_SUAT);
  });

  it.each(['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'])(
    '%s ausente -> 403 missing_required_permission com essa permissão, antes de qualquer chamada à Page',
    async (missing) => {
      permissionsResponse = () => permissionsOkResponse(grantedExcept(missing));
      const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'missing_required_permission', permission: missing });
      expect(callsFor('/me/accounts')).toHaveLength(0);
      expect(callsFor('/subscribed_apps')).toHaveLength(0);
    },
  );

  it('permissão com status declined conta como ausente', async () => {
    permissionsResponse = () =>
      permissionsOkResponse([
        ...grantedExcept('leads_retrieval'),
        { permission: 'leads_retrieval', status: 'declined' },
      ]);
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
    expect(res.status).toBe(403);
    expect((await res.json()).permission).toBe('leads_retrieval');
  });

  it('permissões extras concedidas não causam falha (302 de review)', async () => {
    permissionsResponse = () =>
      permissionsOkResponse([
        ...REQUIRED_GRANTED_PERMISSIONS.map((permission) => ({ permission, status: 'granted' })),
        { permission: 'ads_management', status: 'granted' },
      ]);
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
    expect(res.status).toBe(302);
  });

  it('falha HTTP em /me/permissions -> 502 user_permissions_lookup_failed, sem /me/accounts, sem vazar corpo ou token', async () => {
    permissionsResponse = () =>
      new Response(JSON.stringify({ error: { message: `boom ${FAKE_SUAT}` } }), { status: 500 });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('user_permissions_lookup_failed');
    expect(text).not.toContain(FAKE_SUAT);
    expect(callsFor('/me/accounts')).toHaveLength(0);
  });

  it('paginação de /me/permissions excedida -> 502 user_permissions_lookup_incomplete (não missing), 5 chamadas, sem /me/accounts', async () => {
    permissionsResponse = () =>
      new Response(
        JSON.stringify({ data: [{ permission: 'pages_show_list', status: 'granted' }], paging: { next: 'https://evil.example.test/n', cursors: { after: 'FAKE-CURSOR' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateFor({ flow: 'review_ui' }) }, bindingCookie()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('user_permissions_lookup_incomplete');
    expect(callsFor('/me/permissions')).toHaveLength(5);
    expect(callsFor('/me/accounts')).toHaveLength(0);
  });

  it('empresa comum (piloto, sem gate de teste): nenhuma chamada a /me/permissions nem à Page', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateFor({ companyId: '22222222-2222-4222-8222-222222222222' }) }, bindingCookie()),
    );
    expect(res.status).toBe(200);
    expect(callsFor('/me/permissions')).toHaveLength(0);
    expect(callsFor('/me/accounts')).toHaveLength(0);
  });
});
