// tests/api/integrations/meta/oauth-callback.test.ts — Route Handler do
// callback OAuth "Login do Facebook para Empresas". Sem rede real, sem
// Meta real, sem banco: segredo fake só em memória. O binding anti-CSRF
// (cookie HttpOnly) agora é OBRIGATÓRIO.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';

// 64 hex = 32 bytes — mesmo formato exigido em produção. Valor FAKE.
const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const ENDPOINT = 'https://crm.example.test/api/integrations/meta/oauth/callback';
const FAKE_CODE = 'AQ' + 'x'.repeat(60); // formato-ish de code, sem valor real
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

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

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback', () => {
  it('10 (spec). callback válido + cookie correspondente + code → 200, code NÃO exposto', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('callback_received');
    expect(body.context).toEqual({ userIdPresent: true, companyIdPresent: true });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAKE_CODE);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(serialized.toLowerCase()).not.toContain('access_token');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('16 (spec). callback bem-sucedido limpa o cookie de binding', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${BINDING_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(setCookie).toContain('HttpOnly');
  });

  it('11 (spec). callback sem cookie → 400 binding_missing', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
  });

  it('12 (spec). callback com cookie errado → 400 binding_invalid, e limpa o cookie', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie('wrong-binding-value')),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_invalid');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
  });

  it('12b. cookie presente mas outro nome → tratado como ausente → 400 binding_missing', async () => {
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, 'outro_cookie=abc; mais=um'),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
  });

  it('state ausente → 400 state_missing (antes do cookie)', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_missing');
  });

  it('state string vazia → 400', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: '' }, bindingCookie()));
    expect(res.status).toBe(400);
  });

  it('14 (spec). state adulterado (assinatura não bate) → 400 state_invalid', async () => {
    const good = stateWithBinding();
    const sig = good.split('.')[1];
    const tampered = Buffer.from(
      JSON.stringify({ v: 1, p: 'meta_oauth', n: 'x', iat: 1, exp: 999999999999 }),
      'utf8',
    ).toString('base64url');
    const res = await GET(
      callbackRequest({ code: FAKE_CODE, state: `${tampered}.${sig}` }, bindingCookie()),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
  });

  it('state assinado com OUTRO segredo → 400 state_invalid', async () => {
    const foreign = createOAuthState({ secret: Buffer.from('b'.repeat(64), 'hex'), binding: BINDING });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: foreign }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
  });

  it('state lixo → 400', async () => {
    for (const bad of ['garbage', 'a.b', 'no-dot-here', `${'x'.repeat(40)}.${'y'.repeat(40)}`]) {
      const res = await GET(callbackRequest({ code: FAKE_CODE, state: bad }, bindingCookie()));
      expect(res.status).toBe(400);
      expect(['state_invalid', 'state_expired', 'binding_invalid']).toContain((await res.json()).error);
    }
  });

  it('13 (spec). state expirado → 400 state_expired', async () => {
    const expired = stateWithBinding({ nowMs: Date.now() - 20 * 60_000, ttlSeconds: 600 });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: expired }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_expired');
  });

  // ── Caminho de ERRO da Meta: state + binding validados ANTES de tratar ──
  const NASTY_DESCRIPTION = 'User denied <script>alert(1)</script> \n\r injection & "quotes" ';

  function errorParams(extra?: Record<string, string>) {
    return {
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: NASTY_DESCRIPTION,
      ...extra,
    };
  }

  it('E1. error + state válido + cookie correspondente → 400 provider_error sanitizado, cookie limpo', async () => {
    const res = await GET(
      callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie()),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'provider_error' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('denied');
    expect(serialized).not.toContain('injection');
    // cookie de binding é consumido também no erro
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${BINDING_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it('E2. error + state SEM cookie → 400 binding_missing (rejeita pelo binding antes do provider)', async () => {
    const res = await GET(callbackRequest(errorParams({ state: stateWithBinding() })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_missing');
  });

  it('E3. error + state + cookie ERRADO → 400 binding_invalid (antes do provider), cookie limpo', async () => {
    const res = await GET(
      callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie('wrong-binding-value')),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('binding_invalid');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
  });

  it('E4. error + state ADULTERADO (com cookie) → 400 state_invalid', async () => {
    const good = stateWithBinding();
    const sig = good.split('.')[1];
    const tampered = Buffer.from(
      JSON.stringify({ v: 1, p: 'meta_oauth', n: 'x', iat: 1, exp: 999999999999 }),
      'utf8',
    ).toString('base64url');
    const res = await GET(
      callbackRequest(errorParams({ state: `${tampered}.${sig}` }), bindingCookie()),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
  });

  it('E5. error + state EXPIRADO (com cookie) → 400 state_expired', async () => {
    const expired = stateWithBinding({ nowMs: Date.now() - 20 * 60_000, ttlSeconds: 600 });
    const res = await GET(callbackRequest(errorParams({ state: expired }), bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_expired');
  });

  it('E6. error SEM state → 400 state_missing (retorno não é de um fluxo iniciado pelo KAPA CRM)', async () => {
    for (const req of [
      callbackRequest(errorParams()), // sem state, sem cookie
      callbackRequest(errorParams(), bindingCookie()), // sem state, com cookie
    ]) {
      const res = await GET(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('state_missing');
    }
  });

  it('E7. error_description malicioso: nunca refletido na resposta nem logado em bruto', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // exercita os ramos: com state+cookie válidos, sem cookie, e sem state
    await GET(callbackRequest(errorParams({ state: stateWithBinding() }), bindingCookie()));
    await GET(callbackRequest(errorParams({ state: stateWithBinding() })));
    await GET(callbackRequest(errorParams()));

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain('User denied');
    expect(logged).not.toContain('<script>');
    expect(logged).not.toContain('injection');
    expect(logged).not.toContain('quotes');
    // só o marcador sanitizado é permitido
    expect(logged).toContain('provider_error');
  });

  it('ausência de code e de error → 400 invalid_request', async () => {
    const res = await GET(callbackRequest({ state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('META_OAUTH_STATE_SECRET ausente → 500 fail closed, sem vazar segredo', async () => {
    vi.stubEnv('META_OAUTH_STATE_SECRET', '');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('server_misconfigured');
    expect(text).not.toContain(STATE_SECRET_HEX);
  });

  it('META_OAUTH_STATE_SECRET com formato inválido → 500 fail closed', async () => {
    vi.stubEnv('META_OAUTH_STATE_SECRET', 'not-hex-and-too-short');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(500);
  });

  it('nenhuma chamada à Graph API / rede (fetch nunca chamado)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('rede não permitida nesta fase');
    }) as typeof fetch);
    await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('nenhuma escrita no banco (createAdminClient nunca chamado)', async () => {
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta fase');
    });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('17 (spec). logs nunca contêm code, state completo, binding nem segredo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = stateWithBinding();
    await GET(callbackRequest({ code: FAKE_CODE, state }, bindingCookie()));
    vi.stubEnv('META_OAUTH_STATE_SECRET', '');
    await GET(callbackRequest({ code: FAKE_CODE, state }, bindingCookie()));

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(FAKE_CODE);
    expect(logged).not.toContain(state);
    expect(logged).not.toContain(BINDING);
    expect(logged).not.toContain(STATE_SECRET_HEX);
    expect(logged).toContain('validated_no_exchange');
  });

  it('resposta de sucesso nunca inclui code, binding, uid/cid ou segredo em nenhum campo', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: stateWithBinding() }, bindingCookie()));
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain(FAKE_CODE);
    expect(serialized).not.toContain(BINDING);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(serialized).not.toContain(STATE_SECRET_HEX);
    expect(serialized).not.toMatch(/secret|access_token|refresh_token/i);
  });
});
