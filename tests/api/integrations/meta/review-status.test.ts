// tests/api/integrations/meta/review-status.test.ts — Route Handler GET
// /api/integrations/meta/oauth/review-status (META-OAUTH-REVIEW-UI).
// Autenticação real do CRM (requireAuthenticatedActor) é mockada; a RPC
// is_platform_super_admin é mockada via um cliente Supabase fake. Sem rede,
// sem Meta, sem banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAuthenticatedActor: vi.fn() }));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});

import { GET } from '@/app/api/integrations/meta/oauth/review-status/route';
import { createReviewResultToken } from '@/lib/server/meta-oauth/review-result';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const APP_URL = 'https://crm.example.test';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/review-status`;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const JWT = 'fake.jwt.value';

function fakeUserClient(opts: { isSuperAdmin?: unknown; superAdminErr?: unknown } = {}) {
  return {
    rpc: vi.fn((name: string) => {
      if (name === 'is_platform_super_admin') {
        return Promise.resolve({ data: opts.isSuperAdmin ?? true, error: opts.superAdminErr ?? null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    }),
  };
}

function authorizedActor(client = fakeUserClient()) {
  return { ok: true as const, actor: { profileId: USER_ID }, client, jwt: JWT };
}

function statusRequest(opts: { token?: string; headers?: Record<string, string> } = {}): Request {
  const url = new URL(ENDPOINT);
  if (opts.token !== undefined) url.searchParams.set('token', opts.token);
  return new Request(url, { method: 'GET', headers: opts.headers });
}

function validToken(companyId = META_TEST_COMPANY_ID): string {
  return createReviewResultToken({ secret: SECRET_BUF, companyId });
}

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  mocks.requireAuthenticatedActor.mockResolvedValue(authorizedActor());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
});

describe('GET /api/integrations/meta/oauth/review-status', () => {
  it('sem Authorization -> 401 unauthenticated', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthenticated');
  });

  it('autenticado mas NÃO Super Admin -> 403 forbidden', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(authorizedActor(fakeUserClient({ isSuperAdmin: false })));
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  it('erro na RPC is_platform_super_admin -> 500 server_misconfigured', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(authorizedActor(fakeUserClient({ superAdminErr: { message: 'boom' } })));
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('server_misconfigured');
  });

  it('sem `token` na querystring -> 400 invalid_request', async () => {
    const res = await GET(statusRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('token adulterado -> 400 token_invalid', async () => {
    const token = validToken();
    const tampered = `${token.slice(0, -2)}xx`;
    const res = await GET(statusRequest({ token: tampered }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('token assinado com OUTRO segredo -> 400 token_invalid', async () => {
    const foreign = createReviewResultToken({ secret: Buffer.from('b'.repeat(64), 'hex'), companyId: META_TEST_COMPANY_ID });
    const res = await GET(statusRequest({ token: foreign }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('token válido para OUTRA company -> 400 token_invalid (context_mismatch)', async () => {
    const token = validToken('11111111-1111-4111-8111-111111111111');
    const res = await GET(statusRequest({ token }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('token expirado -> 400 token_invalid', async () => {
    const token = createReviewResultToken({ secret: SECRET_BUF, companyId: META_TEST_COMPANY_ID, nowMs: Date.now() - 10 * 60_000 });
    const res = await GET(statusRequest({ token }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('Super Admin + token válido para a company de teste -> 200 com stage/page/pageSubscription, sem segredo', async () => {
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('test_page_permissions_verified');
    expect(body.page).toEqual({ matched: true, advertiseTaskPresent: true, readEngagementVerified: true });
    expect(body.pageSubscription).toEqual({ verified: true, field: 'leadgen' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(STATE_SECRET_HEX);
    expect(serialized).not.toContain(JWT);
  });

  it('META_OAUTH_STATE_SECRET ausente -> 500 fail closed, sem vazar segredo', async () => {
    vi.stubEnv('META_OAUTH_STATE_SECRET', '');
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(STATE_SECRET_HEX);
  });

  it('nenhuma chamada à Graph API / rede (fetch nunca chamado)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('rede não permitida nesta rota');
    }) as typeof fetch);
    await GET(statusRequest({ token: validToken() }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('nenhuma escrita no banco (createAdminClient nunca chamado)', async () => {
    const admin = await import('@/lib/server/supabase/admin');
    const spy = vi.spyOn(admin, 'createAdminClient').mockImplementation(() => {
      throw new Error('nenhuma escrita no banco nesta rota');
    });
    const res = await GET(statusRequest({ token: validToken() }));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs nunca contêm JWT nem segredo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await GET(statusRequest({ token: validToken() }));
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(JWT);
    expect(logged).not.toContain(STATE_SECRET_HEX);
    expect(logged).toContain('verified');
  });
});
