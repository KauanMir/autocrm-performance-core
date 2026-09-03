// tests/api/integrations/meta/oauth-callback.test.ts — Route Handler do
// callback OAuth "Login do Facebook para Empresas". Sem rede real, sem
// Meta real, sem banco: segredo fake so em memoria. O binding anti-CSRF
// (cookie HttpOnly) e OBRIGATORIO. A troca code -> access token e feita
// server-side apos todo o gate, via GET direto a Meta (doc oficial); o
// endpoint de token da Meta e MOCKADO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';

// Valores FAKE, so em memoria.
const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
// APP_URL de Production (o redirect_uri enviado a Meta deve ser EXATO).
const APP_URL = 'https://crm.assessoriakapa.com.br';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/callback`;
const EXPECTED_REDIRECT_URI = `${APP_URL}/api/integrations/meta/oauth/callback`;
const GRAPH_VERSION = 'v26.0';
const EXPECTED_TOKEN_ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
const FAKE_CODE = 'AQ' + 'x'.repeat(60);
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real-000000000000';
const FAKE_ACCESS_TOKEN = 'FAKE-META-ACCESS-TOKEN-must-never-leak-000';

let fetchMock: ReturnType<typeof vi.spyOn>;

function tokenOkResponse(bodyOverride?: unknown): Response {
  const body =
    bodyOverride === undefined
      ? { access_token: FAKE_ACCESS_TOKEN, token_type: 'bearer', expires_in: 5183944 }
      : bodyOverride;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stateWithBinding(overrides?: { nowMs?: number; ttlSeconds?: number; binding?: string }): string {
  return createOAuthState({
    secret: SECRET_BUF,
    binding: overrides?.binding ?? BINDING,
    userId: USER_ID,
    companyId: COMPANY_ID,
    nowMs: overrides?.nowMs,
    ttlSeconds: overrides?.ttlSeconds,
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

function okRequest(): Request {
  return callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie());
}

// A troca e um GET: os parametros vao na querystring da URL server-to-server.
function lastFetchUrlString(): string {
  const arg = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0];
  return typeof arg === 'string' ? arg : String(arg); // aceita string ou URL
}

function lastFetchUrl(): URL {
  return new URL(lastFetchUrlString());
}

function lastFetchInit(): RequestInit {
  return (fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_GRAPH_API_VERSION', GRAPH_VERSION);
  vi.stubEnv('APP_URL', APP_URL);
  fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenOkResponse());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback', () => {
  // ────────────────────────────────────────────────────────────────────
  // Gate de seguranca (state + binding) — inalterado
  // ────────────────────────────────────────────────────────────────────
  it('11 (spec). callback sem cookie -> 400 binding_missing; token endpoint NAO chamado', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('12 (spec). cookie errado -> 400 binding_invalid, cookie limpo; token endpoint NAO chamado', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie('wrong-binding-value')),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_invalid');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('12b. cookie com outro nome -> tratado como ausente -> 400 binding_missing', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, 'outro_cookie=abc; mais=um'),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state ausente / vazio -> 400 state_missing (antes do cookie); token endpoint NAO chamado', async () => {
    for (const p of [{ code: FAKE_CODE }, { code: FAKE_CODE, state: '' }]) {
      const res = await GET(callbackRequest(p, bindingCookie()));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('14 (spec). state adulterado -> 400 state_invalid; token endpoint NAO chamado', async () => {
    const sig = stateWithBinding().split('.')[1];
    const tampered = Buffer.from(
      JSON.stringify({ v: 1, p: 'meta_oauth', n: 'x', iat: 1, exp: 999999999999 }),
      'utf8',
    ).toString('base64url');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: `${tampered}.${sig}` }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state assinado com OUTRO segredo -> 400 state_invalid', async () => {
    const foreign = createOAuthState({ secret: Buffer.from('b'.repeat(64), 'hex'), binding: BINDING });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: foreign }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('13 (spec). state expirado -> 400 state_expired; token endpoint NAO chamado', async () => {
    const expired = stateWithBinding({ nowMs: Date.now() - 20 * 60_000, ttlSeconds: 600 });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: expired }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ausencia de code e de error -> 400 invalid_request', async () => {
    const res = await GET(callbackRequest({ state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('META_OAUTH_STATE_SECRET ausente / invalido -> 500 fail closed, sem vazar segredo', async () => {
    for (const bad of ['', 'not-hex-and-too-short']) {
      vi.stubEnv('META_OAUTH_STATE_SECRET', bad);
      const res = await GET(okRequest());
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain(STATE_SECRET_HEX);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Caminho de ERRO da Meta — gate ANTES de tratar; token endpoint NUNCA
  // ────────────────────────────────────────────────────────────────────
  const NASTY_DESCRIPTION = 'User denied <script>alert(1)</script> \\n\\r injection & "quotes" ';

  function errorParams(extra?: Record<string, string>) {
    return {
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: NASTY_DESCRIPTION,
      ...extra,
    };
  }

  it('8 (spec). provider_error com state+cookie validos -> 400, NAO chama token endpoint, cookie limpo, token endpoint NAO chamado', async () => {
    const res = await GET(callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'provider_error' });
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E2. error + state SEM cookie -> 400 binding_missing; token endpoint NAO chamado', async () => {
    const res = await GET(callbackRequest(errorParams({ state: stateWithBinding() })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E3. error + cookie ERRADO -> 400 binding_invalid; token endpoint NAO chamado', async () => {
    const res = await GET(
      callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie('wrong-binding-value')),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E4. error + state adulterado -> 400 state_invalid', async () => {
    const sig = stateWithBinding().split('.')[1];
    const tampered = Buffer.from(
      JSON.stringify({ v: 1, p: 'meta_oauth', n: 'x', iat: 1, exp: 999999999999 }),
      'utf8',
    ).toString('base64url');
    const res = await GET(callbackRequest(errorParams({ state: `${tampered}.${sig}` }), bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E5. error + state expirado -> 400 state_expired', async () => {
    const expired = stateWithBinding({ nowMs: Date.now() - 20 * 60_000, ttlSeconds: 600 });
    const res = await GET(callbackRequest(errorParams({ state: expired }), bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E6. error SEM state -> 400 state_missing', async () => {
    for (const req of [
      callbackRequest(errorParams()),
      callbackRequest(errorParams(), bindingCookie()),
    ]) {
      const res = await GET(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('state_missing');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E7. error_description malicioso: nunca refletido nem logado em bruto', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await GET(callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie()));
    await GET(callbackRequest(errorParams({ state: stateWithBinding() })));
    await GET(callbackRequest(errorParams()));
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain('User denied');
    expect(logged).not.toContain('<script>');
    expect(logged).not.toContain('injection');
    expect(logged).not.toContain('quotes');
    expect(logged).toContain('provider_error');
  });

  // ────────────────────────────────────────────────────────────────────
  // Troca code -> access token (server-side, endpoint mockado)
  // ────────────────────────────────────────────────────────────────────
  it('1 (spec). code + state + binding validos + Meta retorna token -> 200 token_exchange_verified, token NUNCA na resposta', async () => {
    const res = await GET(okRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('token_exchange_verified');
    expect(body.context).toEqual({ userIdPresent: true, companyIdPresent: true });
    expect(body.token).toEqual({ received: true });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAKE_ACCESS_TOKEN);
    expect(serialized).not.toContain(FAKE_CODE);
    expect(serialized).not.toContain(APP_SECRET);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(serialized).not.toMatch(/access_token|refresh_token|client_secret/i);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('16 (spec). troca bem-sucedida limpa o cookie de binding (anti-replay)', async () => {
    const res = await GET(okRequest());
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${BINDING_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(setCookie).toContain('HttpOnly');
  });

  it('2 (spec). request para a Meta: GET no endpoint oficial v26.0, query com client_id/client_secret/redirect_uri/code', async () => {
    await GET(okRequest());
    // (7 spec) somente UMA chamada ao endpoint
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (1 spec) metodo GET
    const init = lastFetchInit();
    expect(String(init.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(init.body).toBeUndefined();

    // (2 spec) endpoint exato quando META_GRAPH_API_VERSION=v26.0
    const u = lastFetchUrl();
    expect(`${u.origin}${u.pathname}`).toBe(EXPECTED_TOKEN_ENDPOINT);
    expect(`${u.origin}${u.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/oauth/access_token',
    );

    // (3 spec) query contem os 4 parametros, com os valores corretos
    expect(u.searchParams.get('client_id')).toBe(APP_ID);
    expect(u.searchParams.get('client_secret')).toBe(APP_SECRET);
    expect(u.searchParams.get('code')).toBe(FAKE_CODE);
    // (4 spec) redirect_uri EXATA da Production
    expect(u.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback',
    );
  });

  it('5 (spec). a URL da troca (com client_secret/code na query) NUNCA e logada', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await GET(okRequest()); // sucesso
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await GET(okRequest()); // falha 5xx

    const fullUrl = lastFetchUrlString();
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(fullUrl);
    expect(logged).not.toContain('client_secret');
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(FAKE_CODE);
    expect(logged).not.toContain('graph.facebook.com');
    expect(logged).not.toContain('oauth/access_token');
  });

  it('3 (spec). META_APP_SECRET ausente -> 500 server_misconfigured (fail closed), token endpoint NAO chamado', async () => {
    vi.stubEnv('META_APP_SECRET', '');
    const res = await GET(okRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('server_misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
  });

  it('META_APP_ID / APP_URL ausentes -> 500 server_misconfigured, token endpoint NAO chamado', async () => {
    for (const key of ['META_APP_ID', 'APP_URL']) {
      vi.stubEnv(key as 'META_APP_ID', '');
      const res = await GET(okRequest());
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('server_misconfigured');
      expect(fetchMock).not.toHaveBeenCalled();
      vi.stubEnv(key as 'META_APP_ID', key === 'APP_URL' ? APP_URL : APP_ID);
    }
  });

  it('troca: Meta 4xx -> 502 token_exchange_failed sanitizado (sem corpo da Meta)', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"secret-ish detail","code":190}}', { status: 400 }),
    );
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'token_exchange_failed' });
    expect(JSON.stringify(body)).not.toContain('secret-ish');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
  });

  it('troca: Meta 5xx -> 502 token_exchange_failed', async () => {
    fetchMock.mockResolvedValue(new Response('upstream boom', { status: 503 }));
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
  });

  it('troca: timeout -> 502 token_exchange_failed', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
  });

  it('6b. erro de rede -> 502 token_exchange_failed', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED graph.facebook.com'));
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
  });

  it('troca: resposta SEM access_token -> 502 token_exchange_failed', async () => {
    fetchMock.mockResolvedValue(tokenOkResponse({ token_type: 'bearer', expires_in: 100 }));
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
  });

  it('7b. access_token vazio ou nao-string -> 502', async () => {
    for (const bad of [{ access_token: '' }, { access_token: 123 }, { access_token: null }, ['x'], 'plain']) {
      fetchMock.mockResolvedValue(tokenOkResponse(bad));
      const res = await GET(okRequest());
      expect(res.status).toBe(502);
    }
  });

  it('troca: JSON invalido da Meta -> 502 token_exchange_failed', async () => {
    fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    const res = await GET(okRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('token_exchange_failed');
  });

  it('6 (spec). o access token nunca aparece: resposta, console.log, console.error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // sucesso
    const okRes = await GET(okRequest());
    const okText = await okRes.text();
    // falha 4xx (a Meta devolveu um corpo com um "token" falso)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: FAKE_ACCESS_TOKEN } }), { status: 400 }),
    );
    const badRes = await GET(okRequest());
    const badText = await badRes.text();

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(okText).not.toContain(FAKE_ACCESS_TOKEN);
    expect(badText).not.toContain(FAKE_ACCESS_TOKEN);
    expect(logged).not.toContain(FAKE_ACCESS_TOKEN);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).toContain('token_exchange_verified');
    expect(logged).toContain('token_exchange_failed');
  });

  it('14 (spec). o code nunca aparece nos logs (caminho de sucesso da troca)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = stateWithBinding();
    await GET(callbackRequest({ code: FAKE_CODE, state }, bindingCookie()));
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(FAKE_CODE);
    expect(logged).not.toContain(state);
    expect(logged).not.toContain(BINDING);
    expect(logged).not.toContain(STATE_SECRET_HEX);
  });

  it('10 (spec). nenhuma escrita no banco (createAdminClient nunca chamado)', async () => {
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta fase');
    });
    const res = await GET(okRequest());
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('7 (spec). sem retries: uma unica chamada ao endpoint de token, mesmo em falha', async () => {
    fetchMock.mockResolvedValue(new Response('err', { status: 500 }));
    await GET(okRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resposta de sucesso nunca inclui code, token, binding, uid/cid ou segredo', async () => {
    const res = await GET(okRequest());
    const serialized = JSON.stringify(await res.json());
    for (const secret of [FAKE_CODE, FAKE_ACCESS_TOKEN, APP_SECRET, BINDING, USER_ID, COMPANY_ID, STATE_SECRET_HEX]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/secret|access_token|refresh_token/i);
  });
});
