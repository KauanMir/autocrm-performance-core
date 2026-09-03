// tests/api/integrations/meta/oauth-callback.test.ts — Route Handler do
// callback OAuth "Login do Facebook para Empresas" (fase fundação). Sem
// rede real, sem Meta real, sem banco: segredo fake só em memória.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { createOAuthState } from '@/lib/server/meta-oauth/state';

// 64 hex = 32 bytes — mesmo formato exigido em produção. Valor FAKE.
const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const ENDPOINT = 'https://crm.example.test/api/integrations/meta/oauth/callback';
const FAKE_CODE = 'AQ' + 'x'.repeat(60); // formato-ish de code, sem valor real

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { method: 'GET' });
}

function validState(overrides?: { nowMs?: number; ttlSeconds?: number }): string {
  return createOAuthState({ secret: SECRET_BUF, ...overrides });
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/integrations/meta/oauth/callback', () => {
  it('1. state válido + code → 200, resposta segura, code NÃO exposto', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('callback_received');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAKE_CODE);
    expect(serialized.toLowerCase()).not.toContain('access_token');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('2. state ausente → 400, rejeitado', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_missing');
  });

  it('2b. state string vazia → 400', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: '' }));
    expect(res.status).toBe(400);
  });

  it('3. state inválido (lixo) → 400, rejeitado', async () => {
    for (const bad of ['garbage', 'a.b', 'no-dot-here', `${'x'.repeat(40)}.${'y'.repeat(40)}`]) {
      const res = await GET(callbackRequest({ code: FAKE_CODE, state: bad }));
      expect(res.status).toBe(400);
      expect(['state_invalid', 'state_expired']).toContain((await res.json()).error);
    }
  });

  it('3b. state assinado com OUTRO segredo → 400 state_invalid', async () => {
    const foreign = createOAuthState({ secret: Buffer.from('b'.repeat(64), 'hex') });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: foreign }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
  });

  it('3c. state com corpo adulterado (assinatura não bate) → 400 state_invalid', async () => {
    const good = validState();
    const [body, sig] = good.split('.');
    const tampered = Buffer.from(JSON.stringify({ v: 1, p: 'meta_oauth', n: 'x', iat: 1, exp: 999999999999 }), 'utf8').toString('base64url');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: `${tampered}.${sig}` }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_invalid');
    // sanity: o body original era diferente
    expect(tampered).not.toBe(body);
  });

  it('4. state expirado → 400 state_expired', async () => {
    // emitido 20 min atrás, TTL 10 min
    const expired = validState({ nowMs: Date.now() - 20 * 60_000, ttlSeconds: 600 });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: expired }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('state_expired');
  });

  it('5. callback com error da Meta → 400, tratado com segurança, sem refletir error_description', async () => {
    const nastyDescription = 'User denied <script>alert(1)</script> \n\r injection & "quotes"';
    const res = await GET(
      callbackRequest({
        error: 'access_denied',
        error_reason: 'user_denied',
        error_description: nastyDescription,
        state: validState(),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'provider_error' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('denied');
    expect(serialized).not.toContain('injection');
  });

  it('5b. error da Meta tem precedência mesmo sem state', async () => {
    const res = await GET(callbackRequest({ error: 'access_denied' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('provider_error');
  });

  it('6. ausência de code e de error → 400 invalid_request', async () => {
    const res = await GET(callbackRequest({ state: validState() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('6b. callback totalmente sem parâmetros → 400 invalid_request', async () => {
    const res = await GET(callbackRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('7. META_OAUTH_STATE_SECRET ausente → 500 fail closed, sem vazar segredo', async () => {
    vi.stubEnv('META_OAUTH_STATE_SECRET', '');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('server_misconfigured');
    expect(text).not.toContain(STATE_SECRET_HEX);
  });

  it('7b. META_OAUTH_STATE_SECRET com formato inválido → 500 fail closed', async () => {
    vi.stubEnv('META_OAUTH_STATE_SECRET', 'not-hex-and-too-short');
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    expect(res.status).toBe(500);
  });

  it('8. nenhuma chamada à Graph API / rede (fetch nunca chamado)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((() => {
        throw new Error('rede não permitida nesta fase');
      }) as typeof fetch);
    await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('9. nenhuma escrita no banco (módulo não importa clientes Supabase)', async () => {
    // O Route Handler e lib/server/meta-oauth/* não devem tocar em
    // createAdminClient/createUserScopedClient. Se importassem e chamassem,
    // este mock explodiria a chamada.
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta fase');
    });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('10. logs nunca contêm code, state completo nem segredo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = validState();
    await GET(callbackRequest({ code: FAKE_CODE, state }));
    // também exercita o caminho de erro de env
    vi.stubEnv('META_OAUTH_STATE_SECRET', '');
    await GET(callbackRequest({ code: FAKE_CODE, state }));

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map((a) => JSON.stringify(a))
      .join('\n');
    expect(logged).not.toContain(FAKE_CODE);
    expect(logged).not.toContain(state);
    expect(logged).not.toContain(STATE_SECRET_HEX);
    // o comprimento do code é permitido; o valor não
    expect(logged).toContain('validated_no_exchange');
  });

  it('resposta de sucesso nunca inclui code, token ou segredo em nenhum campo', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: validState() }));
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain(FAKE_CODE);
    expect(serialized).not.toContain(STATE_SECRET_HEX);
    expect(serialized).not.toMatch(/secret|access_token|refresh_token/i);
  });
});
