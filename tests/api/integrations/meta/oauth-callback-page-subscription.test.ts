// tests/api/integrations/meta/oauth-callback-page-subscription.test.ts —
// caminho de TESTE TÉCNICO CONTROLADO do callback OAuth: quando (e SÓ
// quando) a company do `state` é a company de teste fixa
// (META_TEST_COMPANY_ID), o callback deriva o Page Access Token via
// GET /me/accounts e, se elegível (Page exata + ADVERTISE presente),
// inscreve a Page de teste (META_TEST_PAGE_ID) no webhook `leadgen` via
// POST /subscribed_apps. Sem rede real, sem Meta real, sem banco — os três
// endpoints da Meta (token exchange, /me/accounts, /subscribed_apps) são
// mockados por pathname.
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
  subscribeResponse = () => subscribeOkResponse();

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const u = urlOf(input);
    if (u.pathname.endsWith('/oauth/access_token')) return tokenResponse();
    if (u.pathname.endsWith('/me/accounts')) return accountsResponse();
    if (u.pathname.endsWith('/subscribed_apps')) return subscribeResponse();
    throw new Error(`unexpected fetch in test: ${u.toString()}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback — teste técnico controlado (subscribed_apps)', () => {
  // 8. company diferente -> não chama /me/accounts nem /subscribed_apps
  it('8. company diferente da company de teste -> resposta padrão, /me/accounts e /subscribed_apps NUNCA chamados', async () => {
    const res = await otherCompanyRequest();
    const response = await GET(res);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stage).toBe('token_exchange_verified');
    expect(callsTo('/me/accounts')).toHaveLength(0);
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
  it('3+4. resposta com várias Pages -> seleciona só META_TEST_PAGE_ID e usa o Page Access Token dela em /subscribed_apps', async () => {
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe('test_page_subscription_verified');
    expect(body.page).toEqual({ matched: true, advertiseTaskPresent: true });
    expect(body.pageSubscription).toEqual({ verified: true, field: 'leadgen' });

    const subCalls = callsTo('/subscribed_apps');
    expect(subCalls).toHaveLength(1);
    const { url, init } = subCalls[0];
    expect(String(init.method ?? '').toUpperCase()).toBe('POST');
    expect(url.searchParams.get('access_token')).toBe(FAKE_PAGE_TOKEN);
    expect(url.searchParams.get('access_token')).not.toBe(OTHER_PAGE_TOKEN);
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

  // 5. Page correta ausente -> não chama subscribed_apps
  it('5. Page alvo ausente da lista -> test_page_not_found, /subscribed_apps NUNCA chamado', async () => {
    accountsResponse = () =>
      accountsOkResponse({ data: [{ id: '999999999999999', name: 'Outra', access_token: OTHER_PAGE_TOKEN, tasks: ['ADVERTISE'] }] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_not_found');
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // 6. Page correta sem access_token -> não chama subscribed_apps
  it('6. Page alvo sem access_token -> test_page_access_token_missing, /subscribed_apps NUNCA chamado', async () => {
    accountsResponse = () =>
      accountsOkResponse({ data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', tasks: ['ADVERTISE'] }] });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_access_token_missing');
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
  });

  // 7. Page correta sem ADVERTISE -> não chama subscribed_apps
  it('7. Page alvo sem task ADVERTISE -> test_page_missing_advertise_task, /subscribed_apps NUNCA chamado', async () => {
    accountsResponse = () =>
      accountsOkResponse({
        data: [{ id: META_TEST_PAGE_ID, name: 'KAPA CRM Teste', access_token: FAKE_PAGE_TOKEN, tasks: ['MANAGE', 'MODERATE'] }],
      });
    const res = await GET(testCompanyRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('test_page_missing_advertise_task');
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

  // 16/17. SUAT e Page Access Token nunca aparecem em response/log/error
  it('16+17. SUAT e Page Access Token nunca aparecem em response, console.log ou console.error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const okRes = await GET(testCompanyRequest());
    const okText = await okRes.text();

    subscribeResponse = () => new Response(JSON.stringify({ error: { message: FAKE_PAGE_TOKEN } }), { status: 400 });
    const failRes = await GET(testCompanyRequest());
    const failText = await failRes.text();

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    for (const secret of [FAKE_SUAT, FAKE_PAGE_TOKEN, OTHER_PAGE_TOKEN]) {
      expect(okText).not.toContain(secret);
      expect(failText).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('test_page_subscription_verified');
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

  // 20. no máximo 1 chamada a /me/accounts e 1 a /subscribed_apps (sem retries)
  it('20. no máximo 1 chamada a /me/accounts e 1 a /subscribed_apps por request, mesmo em falha', async () => {
    subscribeResponse = () => new Response('err', { status: 500 });
    await GET(testCompanyRequest());
    expect(callsTo('/me/accounts')).toHaveLength(1);
    expect(callsTo('/subscribed_apps')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3); // token + accounts + subscribe
  });

  it('resposta de sucesso do caminho de teste nunca inclui SUAT, Page token, code ou outras Pages', async () => {
    const res = await GET(testCompanyRequest());
    const serialized = JSON.stringify(await res.json());
    for (const secret of [FAKE_SUAT, FAKE_PAGE_TOKEN, OTHER_PAGE_TOKEN, FAKE_CODE, '999999999999999']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
