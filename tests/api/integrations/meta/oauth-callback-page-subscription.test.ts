// tests/api/integrations/meta/oauth-callback-page-subscription.test.ts —
// caminho de TESTE TÉCNICO CONTROLADO do callback OAuth: quando (e SÓ
// quando) a company do `state` é a company de teste fixa
// (META_TEST_COMPANY_ID), o callback deriva o Page Access Token via
// GET /me/accounts, faz UMA leitura mínima e read-only de conteúdo
// publicado pela própria Page (GET /{page-id}/posts?fields=id&limit=1 —
// pages_read_engagement) e, se elegível (Page exata + ADVERTISE presente +
// leitura OK), inscreve a Page de teste (META_TEST_PAGE_ID) no webhook
// `leadgen` via POST /subscribed_apps. Sem rede real, sem Meta real, sem
// banco — os quatro endpoints da Meta (token exchange, /me/accounts,
// GET /{page-id}/posts, /subscribed_apps) são mockados por pathname.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';
import {
  META_TEST_COMPANY_ID,
  META_TEST_PAGE_ID,
  LEADGEN_SUBSCRIBED_FIELD,
  REQUIRED_LEADGEN_PAGE_TASK,
} from '@/lib/server/meta-oauth/config';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const APP_URL = 'https://crm.assessoriakapa.com.br';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/callback`;
const GRAPH_VERSION = 'v26.0';
const FAKE_CODE = 'AQ' + 'x'.repeat(60);
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';

const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real-000000000000';

const FAKE_SUAT = 'FAKE-SUAT-TOKEN-must-never-leak-000';
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-ACCESS-TOKEN-must-never-leak-111';
const OTHER_PAGE_TOKEN = 'other-unrelated-page-token-must-never-leak';

let fetchMock: ReturnType<typeof vi.spyOn>;

// ── respostas fake, sobrescrevíveis por teste ───────────────────────────
let tokenResponse: () => Response = () => tokenOkResponse();
let accountsResponse: () => Response = () => accountsOkResponse();
let readEngagementResponse: () => Response = () => readEngagementOkResponse();
let subscribeResponse: () => Response = () => subscribeOkResponse();

function tokenOkResponse(): Response {
  return new Response(JSON.stringify({ access_token: FAKE_SUAT, token_type: 'bearer', expires_in: 5183944 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function accountsOkResponse(overrides?: { data?: unknown[] }): Response {
  const data =
    overrides?.data ?? [
      { id: '999999999999999', name: 'Outra Pagina', access_token: OTHER_PAGE_TOKEN, tasks: ['MANAGE'] },
      {
        id: META_TEST_PAGE_ID,
        name: 'KAPA CRM Teste',
        access_token: FAKE_PAGE_TOKEN,
        tasks: [REQUIRED_LEADGEN_PAGE_TASK, 'MANAGE'],
      },
    ];
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function readEngagementOkResponse(overrides?: { data?: unknown[] }): Response {
  const data = overrides?.data ?? [{ id: 'post-fake-id-000000000000000' }];
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function subscribeOkResponse(): Response {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(arg: unknown): URL {
  return arg instanceof URL ? arg : new URL(String(arg));
}

function stateWithBinding(companyId: string, overrides?: { binding?: string }): string {
  return createOAuthState({
    secret: SECRET_BUF,
    binding: overrides?.binding ?? BINDING,
    userId: USER_ID,
    companyId,
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

function testCompanyRequest(): Request {
  return callbackRequest({ code: FAKE_CODE, state: stateWithBinding(META_TEST_COMPANY_ID) }, bindingCookie());
}

function otherCompanyRequest(): Request {
  return callbackRequest({ code: FAKE_CODE, state: stateWithBinding(OTHER_COMPANY_ID) }, bindingCookie());
}

function callsTo(pathSuffix: string): { url: URL; init: RequestInit }[] {
  return fetchMock.mock.calls
    .map((c) => ({ url: urlOf(c[0]), init: (c[1] ?? {}) as RequestInit }))
    .filter((c) => c.url.pathname.endsWith(pathSuffix));
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_GRAPH_API_VERSION', GRAPH_VERSION);
  vi.stubEnv('APP_URL', APP_URL);

  tokenResponse = () => tokenOkResponse();
  accountsResponse = () => accountsOkResponse();
  readEngagementResponse = () => readEngagementOkResponse();
  subscribeResponse = () => subscribeOkResponse();

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const u = urlOf(input);
    if (u.pathname.endsWith('/oauth/access_token')) return tokenResponse();
    if (u.pathname.endsWith('/me/accounts')) return accountsResponse();
    if (u.pathname.endsWith('/subscribed_apps')) return subscribeResponse();
    if (u.pathname === `/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`) return readEngagementResponse();
    throw new Error(`unexpected fetch in test: ${u.toString()}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback — teste técnico controlado (subscribed_apps + pages_read_engagement)', () => {
  // 4/8. company diferente -> não chama /me/accounts, GET /{page-id} nem /subscribed_apps
  it('6. company diferente da company de teste -> resposta padrão, /me/accounts, GET /{page-id}/posts e /subscribed_apps NUNCA chamados', async () => {
    const res = await otherCompanyRequest();
    const response = await GET(res);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stage).toBe('token_exchange_verified');
    expect(callsTo('/me/accounts')).toHaveLength(0);
    expect(callsTo('/posts')).toHaveLength(0);
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o token exchange
  });

  // 1. token exchange OK + company teste -> chama /me/accounts
  it('1. token exchange OK + company de teste -> GET /me/accounts executado', async () => {
    await GET(testCompanyRequest());
    expect(callsTo('/me/accounts')).toHaveLength(1);
  });

  // 2. /me/accounts solicita apenas os campos necessários
  it('2. /me/accounts solicita fields=id,name,access_token,tasks e leva o SUAT como access_token', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/me/accounts');
    expect(url.searchParams.get('fields')).toBe('id,name,access_token,tasks');
    expect(url.searchParams.get('access_token')).toBe(FAKE_SUAT);
    expect(url.origin).toBe('https://graph.facebook.com');
    expect(url.pathname).toBe(`/${GRAPH_VERSION}/me/accounts`);
  });

  // 3 + 4. várias Pages -> seleciona só a Page alvo -> chama subscribed_apps com o token DELA
  it('3+4. resposta com várias Pages -> seleciona só META_TEST_PAGE_ID e usa o Page Access Token dela em GET /{page-id}/posts e /subscribed_apps', async () => {
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('test_page_permissions_verified');
    expect(body.page).toEqual({ matched: true, advertiseTaskPresent: true, readEngagementVerified: true });
    expect(body.pageSubscription).toEqual({ verified: true, field: 'leadgen' });

    const subCalls = callsTo('/subscribed_apps');
    expect(subCalls).toHaveLength(1);
    const { url, init } = subCalls[0];
    expect(String(init.method ?? '').toUpperCase()).toBe('POST');
    expect(url.searchParams.get('access_token')).toBe(FAKE_PAGE_TOKEN);
    expect(url.searchParams.get('access_token')).not.toBe(OTHER_PAGE_TOKEN);
  });

  // 1. company teste + Page token válido -> chama GET /{page-id}/posts (read-only)
  it('1. company de teste + Page token válido -> GET /{page-id}/posts executado (leitura read-only)', async () => {
    await GET(testCompanyRequest());
    expect(callsTo('/posts')).toHaveLength(1);
  });

  // 1. endpoint exato: /v26.0/1381033925087695/posts
  it('1. GET /{page-id}/posts usa o endpoint exato e a versão v26.0, com GET e o Page Access Token', async () => {
    await GET(testCompanyRequest());
    const [{ url, init }] = callsTo('/posts');
    expect(`${url.origin}${url.pathname}`).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`);
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.facebook.com/v26.0/1381033925087695/posts');
    expect(String(init.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(url.searchParams.get('access_token')).toBe(FAKE_PAGE_TOKEN);
    expect(url.searchParams.get('access_token')).not.toBe(OTHER_PAGE_TOKEN);
  });

  // 5. método GET
  it('5. GET /{page-id}/posts usa o método GET', async () => {
    await GET(testCompanyRequest());
    const [{ init }] = callsTo('/posts');
    expect(String(init.method ?? 'GET').toUpperCase()).toBe('GET');
  });

  // 2. fields=id
  it('2. GET /{page-id}/posts solicita fields EXATAMENTE "id"', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/posts');
    expect(url.searchParams.get('fields')).toBe('id');
  });

  // 3. limit=1
  it('3. GET /{page-id}/posts solicita limit EXATAMENTE "1"', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/posts');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  // 4. nenhuma outra field (nem message, comentários, reactions, insights, dados de usuário)
  it('4. GET /{page-id}/posts não envia nenhum outro parâmetro de campo além de fields/limit/access_token', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/posts');
    const keys = [...url.searchParams.keys()].sort();
    expect(keys).toEqual(['access_token', 'fields', 'limit']);
    for (const forbidden of ['message', 'comments', 'reactions', 'insights', 'from', 'likes']) {
      expect(url.searchParams.has(forbidden)).toBe(false);
    }
  });

  // 8. resposta {data: []} (Page sem posts) é sucesso
  it('8. GET /{page-id}/posts devolve {data:[]} (Page sem posts) -> ainda é sucesso (test_page_permissions_verified)', async () => {
    readEngagementResponse = () => readEngagementOkResponse({ data: [] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('test_page_permissions_verified');
    expect(body.page.readEngagementVerified).toBe(true);
    expect(callsTo('/subscribed_apps')).toHaveLength(1);
  });

  // 9. resposta {data:[{id:"..."}]} é sucesso
  it('9. GET /{page-id}/posts devolve {data:[{id:"..."}]} -> sucesso (test_page_permissions_verified)', async () => {
    readEngagementResponse = () => readEngagementOkResponse({ data: [{ id: 'real-looking-post-id' }] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('test_page_permissions_verified');
    expect(body.page.readEngagementVerified).toBe(true);
  });

  // resposta do post (id, mesmo não sensível) nunca aparece na resposta ao browser
  it('o `id` do post devolvido pela Meta nunca aparece na resposta do callback', async () => {
    readEngagementResponse = () => readEngagementOkResponse({ data: [{ id: 'must-not-leak-post-id-123' }] });
    const res = await GET(testCompanyRequest());
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain('must-not-leak-post-id-123');
  });

  // GET /{page-id}/posts deve ocorrer ANTES do POST /subscribed_apps (leitura antes de escrita)
  it('a leitura (pages_read_engagement) ocorre antes da inscrição em /subscribed_apps', async () => {
    await GET(testCompanyRequest());
    const readCallIndex = fetchMock.mock.calls.findIndex((c) => urlOf(c[0]).pathname === `/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`);
    const subscribeCallIndex = fetchMock.mock.calls.findIndex((c) => urlOf(c[0]).pathname.endsWith('/subscribed_apps'));
    expect(readCallIndex).toBeGreaterThanOrEqual(0);
    expect(subscribeCallIndex).toBeGreaterThan(readCallIndex);
  });

  // 14. subscribed_fields é EXATAMENTE leadgen
  it('14. subscribed_fields enviado é EXATAMENTE "leadgen"', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/subscribed_apps');
    expect(url.searchParams.get('subscribed_fields')).toBe(LEADGEN_SUBSCRIBED_FIELD);
    expect(url.searchParams.get('subscribed_fields')).toBe('leadgen');
  });

  // 15. endpoint exato
  it('15. endpoint exato: /v26.0/1381033925087695/subscribed_apps', async () => {
    await GET(testCompanyRequest());
    const [{ url }] = callsTo('/subscribed_apps');
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://graph.facebook.com/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/subscribed_apps`,
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/1381033925087695/subscribed_apps',
    );
  });

  // 5. Page correta ausente -> não chama GET /{page-id}/posts nem subscribed_apps
  it('5. Page alvo ausente da lista -> test_page_not_found, GET /{page-id}/posts e /subscribed_apps NUNCA chamados', async () => {
    accountsResponse = () =>
      accountsOkResponse({ data: [{ id: '999999999999999', name: 'Outra', access_token: OTHER_PAGE_TOKEN, tasks: ['ADVERTISE'] }] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_not_found');
    expect(callsTo('/posts')).toHaveLength(0);
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // 7. Page token ausente -> não chama GET /{page-id}/posts nem subscribed_apps
  it('7. Page alvo sem access_token -> test_page_access_token_missing, GET /{page-id}/posts e /subscribed_apps NUNCA chamados', async () => {
    accountsResponse = () =>
      accountsOkResponse({ data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', tasks: ['ADVERTISE'] }] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_access_token_missing');
    expect(callsTo('/posts')).toHaveLength(0);
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // Page sem ADVERTISE -> não chama GET /{page-id}/posts nem subscribed_apps
  it('Page alvo sem task ADVERTISE -> test_page_missing_advertise_task, GET /{page-id}/posts e /subscribed_apps NUNCA chamados', async () => {
    accountsResponse = () =>
      accountsOkResponse({
        data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: ['MANAGE', 'MODERATE'] }],
      });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_missing_advertise_task');
    expect(callsTo('/posts')).toHaveLength(0);
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // 10. falha na leitura (pages_read_engagement) -> erro sanitizado, /subscribed_apps NUNCA chamado
  it('10a. GET /{page-id}/posts 4xx -> test_page_read_engagement_failed sanitizado, /subscribed_apps NUNCA chamado', async () => {
    readEngagementResponse = () => new Response('{"error":{"message":"secret-ish"}}', { status: 400 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'test_page_read_engagement_failed' });
    expect(JSON.stringify(body)).not.toContain('secret-ish');
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  it('10b. GET /{page-id}/posts 5xx -> test_page_read_engagement_failed', async () => {
    readEngagementResponse = () => new Response('boom', { status: 500 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_read_engagement_failed');
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  it('10c. GET /{page-id}/posts timeout -> test_page_read_engagement_failed', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const u = urlOf(input);
      if (u.pathname.endsWith('/oauth/access_token')) return tokenResponse();
      if (u.pathname.endsWith('/me/accounts')) return accountsResponse();
      if (u.pathname === `/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`) {
        const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
        throw err;
      }
      throw new Error('unexpected fetch');
    });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_read_engagement_failed');
  });

  it('GET /{page-id}/posts devolve corpo sem `data` (formato inesperado) -> test_page_read_engagement_failed', async () => {
    readEngagementResponse = () => new Response(JSON.stringify({ paging: {} }), { status: 200 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_read_engagement_failed');
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // 9/10. state/binding inválidos -> nenhuma chamada de negócio (mesmo com company de teste no payload)
  it('9. state inválido (mesmo com company de teste) -> nenhuma chamada Graph API de negócio', async () => {
    const tampered = 'not-a-valid-state';
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: tampered }, bindingCookie()));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('10. binding inválido (mesmo com company de teste) -> nenhuma chamada Graph API de negócio', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateWithBinding(META_TEST_COMPANY_ID) }, bindingCookie('wrong')),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 11. token exchange falha -> não chama /me/accounts
  it('11. token exchange falha (company de teste) -> /me/accounts NUNCA chamado', async () => {
    tokenResponse = () => new Response('upstream boom', { status: 503 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
    expect(callsTo('/me/accounts')).toHaveLength(0);
  });

  // 12. /me/accounts 4xx/5xx/timeout -> erro sanitizado
  it('12a. /me/accounts 4xx -> page_token_lookup_failed sanitizado', async () => {
    accountsResponse = () => new Response('{"error":{"message":"secret-ish"}}', { status: 400 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'page_token_lookup_failed' });
    expect(JSON.stringify(body)).not.toContain('secret-ish');
  });

  it('12b. /me/accounts 5xx -> page_token_lookup_failed', async () => {
    accountsResponse = () => new Response('boom', { status: 500 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('page_token_lookup_failed');
  });

  it('12c. /me/accounts timeout -> page_token_lookup_failed', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const u = urlOf(input);
      if (u.pathname.endsWith('/oauth/access_token')) return tokenResponse();
      if (u.pathname.endsWith('/me/accounts')) {
        const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
        throw err;
      }
      throw new Error('unexpected fetch');
    });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('page_token_lookup_failed');
  });

  // 13. subscribed_apps 4xx/5xx/timeout -> erro sanitizado
  it('13a. /subscribed_apps 4xx -> test_page_subscription_failed sanitizado', async () => {
    subscribeResponse = () => new Response('{"error":{"message":"secret-ish"}}', { status: 400 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'test_page_subscription_failed' });
    expect(JSON.stringify(body)).not.toContain('secret-ish');
  });

  it('13b. /subscribed_apps 5xx -> test_page_subscription_failed', async () => {
    subscribeResponse = () => new Response('boom', { status: 500 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_subscription_failed');
  });

  it('13c. /subscribed_apps timeout -> test_page_subscription_failed', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const u = urlOf(input);
      if (u.pathname.endsWith('/oauth/access_token')) return tokenResponse();
      if (u.pathname.endsWith('/me/accounts')) return accountsResponse();
      if (u.pathname === `/${GRAPH_VERSION}/${META_TEST_PAGE_ID}/posts`) return readEngagementResponse();
      if (u.pathname.endsWith('/subscribed_apps')) {
        const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
        throw err;
      }
      throw new Error('unexpected fetch');
    });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_subscription_failed');
  });

  it('13d. /subscribed_apps devolve success:false -> test_page_subscription_failed', async () => {
    subscribeResponse = () => new Response(JSON.stringify({ success: false }), { status: 200 });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_subscription_failed');
  });

  // 11. SUAT e Page Access Token nunca aparecem em response/log/error
  it('11. SUAT e Page Access Token nunca aparecem em response, console.log ou console.error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const okRes = await GET(testCompanyRequest());
    const okText = await okRes.text();

    subscribeResponse = () => new Response(JSON.stringify({ error: { message: FAKE_PAGE_TOKEN } }), { status: 400 });
    const failRes = await GET(testCompanyRequest());
    const failText = await failRes.text();

    readEngagementResponse = () => new Response(JSON.stringify({ error: { message: FAKE_PAGE_TOKEN } }), { status: 400 });
    const readFailRes = await GET(testCompanyRequest());
    const readFailText = await readFailRes.text();

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    for (const secret of [FAKE_SUAT, FAKE_PAGE_TOKEN, OTHER_PAGE_TOKEN]) {
      expect(okText).not.toContain(secret);
      expect(failText).not.toContain(secret);
      expect(readFailText).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('test_page_permissions_verified');
    expect(logged).toContain('test_page_read_engagement_failed');
  });

  // 18. OAuth code nunca aparece nos logs neste caminho
  it('18. o code OAuth nunca aparece nos logs no caminho de teste controlado', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await GET(testCompanyRequest());
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(FAKE_CODE);
  });

  // 19. nenhuma escrita no banco
  it('19. nenhuma escrita no banco (createAdminClient nunca chamado) no caminho de teste', async () => {
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta fase');
    });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  // 12. no máximo 1 chamada a /me/accounts, 1 a GET /{page-id}/posts e 1 a /subscribed_apps (sem retries) — nenhuma persistência de estado entre chamadas
  it('12. no máximo 1 chamada a /me/accounts, GET /{page-id}/posts e /subscribed_apps por request, mesmo em falha', async () => {
    subscribeResponse = () => new Response('err', { status: 500 });
    await GET(testCompanyRequest());
    expect(callsTo('/me/accounts')).toHaveLength(1);
    expect(callsTo('/posts')).toHaveLength(1);
    expect(callsTo('/subscribed_apps')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4); // token + accounts + read engagement (posts) + subscribe
  });

  it('resposta de sucesso do caminho de teste nunca inclui SUAT, Page token, code ou outras Pages', async () => {
    const res = await GET(testCompanyRequest());
    const serialized = JSON.stringify(await res.json());
    for (const secret of [FAKE_SUAT, FAKE_PAGE_TOKEN, OTHER_PAGE_TOKEN, FAKE_CODE, '999999999999999']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
