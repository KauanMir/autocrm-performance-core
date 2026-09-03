// tests/api/integrations/meta/oauth-start.test.ts — Route Handler POST
// /api/integrations/meta/oauth/start. Autenticação real do CRM
// (requireAuthenticatedActor) é mockada; as RPCs de company/role são
// mockadas via um cliente Supabase fake. Sem rede, sem Meta, sem banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAuthenticatedActor: vi.fn() }));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});

import { POST } from '@/app/api/integrations/meta/oauth/start/route';
import { verifyOAuthState } from '@/lib/server/meta-oauth/state';
import { BINDING_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const APP_ID = '1234567890123456';
const LOGIN_CONFIG_ID = '9876543210987654';
const APP_URL = 'https://crm.example.test';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/start`;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const JWT = 'fake.jwt.value';

function fakeUserClient(opts: {
  companyId?: string | null;
  companyErr?: unknown;
  allowed?: unknown;
  permErr?: unknown;
} = {}) {
  return {
    rpc: vi.fn((name: string) => {
      if (name === 'current_membership_company_id') {
        return Promise.resolve({ data: opts.companyId ?? null, error: opts.companyErr ?? null });
      }
      if (name === 'is_manager_or_platform') {
        return Promise.resolve({ data: opts.allowed ?? true, error: opts.permErr ?? null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    }),
  };
}

function authorizedActor(client = fakeUserClient({ companyId: COMPANY_ID, allowed: true })) {
  return { ok: true as const, actor: { profileId: USER_ID }, client, jwt: JWT };
}

function startRequest(opts: { body?: unknown; headers?: Record<string, string> } = {}): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json', ...opts.headers },
  });
}

function cookieValueFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(';')[0];
  const eq = first.indexOf('=');
  return eq > 0 ? first.slice(eq + 1) : null;
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_LOGIN_CONFIG_ID', LOGIN_CONFIG_ID);
  vi.stubEnv('APP_URL', APP_URL);
  mocks.requireAuthenticatedActor.mockResolvedValue(authorizedActor());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
});

describe('POST /api/integrations/meta/oauth/start', () => {
  it('1. usuário não autenticado → 401 unauthenticated', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    const res = await POST(startRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthenticated');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('2. autenticado sem company resolvível (sem body, sem membership) → 403 company_unresolved', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(authorizedActor(fakeUserClient({ companyId: null })));
    const res = await POST(startRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('company_unresolved');
  });

  it('2b. autenticado, company do body, mas sem acesso/permite=false → 403 forbidden', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(
      authorizedActor(fakeUserClient({ allowed: false })),
    );
    const res = await POST(startRequest({ body: { company_id: COMPANY_ID } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  it('3. role sem permissão (seller → is_manager_or_platform=false) → 403 forbidden', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(
      authorizedActor(fakeUserClient({ companyId: COMPANY_ID, allowed: false })),
    );
    const res = await POST(startRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('4. usuário autorizado → 200, authorizationUrl (fluxo FLB: config_id, sem scope), cookie HttpOnly', async () => {
    const res = await POST(startRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('authorization_url_ready');
    expect(body.flow).toBe('facebook_login_for_business');
    expect(typeof body.authorizationUrl).toBe('string');

    const authUrl = new URL(body.authorizationUrl);
    expect(authUrl.host).toBe('www.facebook.com');
    expect(authUrl.pathname).toMatch(/\/v\d+\.\d+\/dialog\/oauth$/);
    // (1) client_id correto
    expect(authUrl.searchParams.get('client_id')).toBe(APP_ID);
    // (2) redirect_uri correta
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://crm.example.test/api/integrations/meta/oauth/callback',
    );
    expect(body.redirectUri).toBe('https://crm.example.test/api/integrations/meta/oauth/callback');
    // (3) state presente
    expect((authUrl.searchParams.get('state') ?? '').length).toBeGreaterThan(20);
    // (4) config_id presente
    expect(authUrl.searchParams.get('config_id')).toBe(LOGIN_CONFIG_ID);
    // (5) scope AUSENTE — no FLB config_id substitui scope
    expect(authUrl.searchParams.has('scope')).toBe(false);
    // fluxo authorization-code + override para code prevalecer
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('override_default_response_type')).toBe('true');
    // corpo não expõe scope nem lista de permissões
    expect('scopes' in body).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/instagram|whatsapp|messenger/i);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${BINDING_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('5. cookie: HttpOnly, SameSite=Lax, Path do fluxo, Max-Age curto; Secure só em produção', async () => {
    const res = await POST(startRequest());
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/api/integrations/meta/oauth');
    expect(setCookie).toMatch(/Max-Age=600\b/);
    expect(setCookie).not.toContain('Secure'); // NODE_ENV=test

    vi.stubEnv('NODE_ENV', 'production');
    const resProd = await POST(startRequest());
    expect(resProd.headers.get('set-cookie') ?? '').toContain('Secure');
  });

  it('6. state gerado: válido, contém contexto (uid/cid/purpose), casa com o cookie, sem segredo', async () => {
    const res = await POST(startRequest());
    const body = await res.json();
    const state = new URL(body.authorizationUrl).searchParams.get('state') ?? '';
    const cookieValue = cookieValueFromSetCookie(res.headers.get('set-cookie')) ?? '';

    const verified = verifyOAuthState(state, { secret: SECRET_BUF, expectedBinding: cookieValue });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.p).toBe('meta_oauth');
      expect(verified.payload.uid).toBe(USER_ID);
      expect(verified.payload.cid).toBe(COMPANY_ID);
      expect(typeof verified.payload.b).toBe('string');
    }
    // segredo nunca aparece no state nem na URL
    expect(state).not.toContain(STATE_SECRET_HEX);
    expect(body.authorizationUrl).not.toContain(STATE_SECRET_HEX);
    // cookie errado -> rejeitado
    const badVerify = verifyOAuthState(state, { secret: SECRET_BUF, expectedBinding: 'wrong' });
    expect(badVerify.ok).toBe(false);
  });

  it('6 (spec). Configuration ID (META_LOGIN_CONFIG_ID) ausente → 500 fail closed', async () => {
    vi.stubEnv('META_LOGIN_CONFIG_ID', '');
    const res = await POST(startRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('server_misconfigured');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('7. env obrigatória ausente → 500 fail closed', async () => {
    const restore: Record<string, string> = {
      META_OAUTH_STATE_SECRET: STATE_SECRET_HEX,
      META_APP_ID: APP_ID,
      META_LOGIN_CONFIG_ID: LOGIN_CONFIG_ID,
      APP_URL,
    };
    for (const key of Object.keys(restore)) {
      vi.stubEnv(key as 'META_APP_ID', '');
      const res = await POST(startRequest());
      expect(res.status, `${key} ausente`).toBe(500);
      expect((await res.json()).error).toBe('server_misconfigured');
      vi.stubEnv(key as 'META_APP_ID', restore[key]); // restaura p/ o próximo
    }
  });

  it('8. nenhuma chamada à Graph API / rede (fetch nunca chamado)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('rede não permitida nesta fase');
    }) as typeof fetch);
    await POST(startRequest());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('9. nenhuma escrita no banco (createAdminClient nunca chamado)', async () => {
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta fase');
    });
    const res = await POST(startRequest());
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Origin divergente → 403 invalid_origin, sem cookie', async () => {
    const res = await POST(startRequest({ headers: { origin: 'https://evil.example.com' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('invalid_origin');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('body inválido (company_id não-UUID) → 400 invalid_body', async () => {
    const res = await POST(startRequest({ body: { company_id: 'not-a-uuid' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('body com chave extra → 400 invalid_body', async () => {
    const res = await POST(startRequest({ body: { company_id: COMPANY_ID, extra: 1 } }));
    expect(res.status).toBe(400);
  });

  it('logs nunca contêm JWT, state, binding nem segredo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(startRequest());
    const body = await res.json();
    const state = new URL(body.authorizationUrl).searchParams.get('state') ?? '';
    const cookieValue = cookieValueFromSetCookie(res.headers.get('set-cookie')) ?? '';

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(JWT);
    expect(logged).not.toContain(state);
    expect(logged).not.toContain(cookieValue);
    expect(logged).not.toContain(STATE_SECRET_HEX);
    expect(logged).toContain('authorization_url_issued');
  });
});
