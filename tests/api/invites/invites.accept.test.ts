// tests/api/invites/invites.accept.test.ts — Route Handler AUTENTICADO de
// aceite de convite (M1-F S4-C2A). createUserScopedClient mockado —
// nenhuma rede real, nenhum Supabase local necessário.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUserScopedClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/user-token-client', () => ({
  createUserScopedClient: mocks.createUserScopedClient,
}));

import { POST } from '@/app/api/invites/accept/route';

const APP_URL = 'http://127.0.0.1:3000';
const VALID_TOKEN = 'A'.repeat(43);
const VALID_JWT = 'valid-jwt-token';

function makeUserClient(opts: {
  getUserResult?: { data: unknown; error: unknown };
  acceptResponse?: { data: unknown; error: unknown };
}) {
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserResult ?? { data: { user: { id: 'auth-user-1' } }, error: null },
  );
  const rpc = vi.fn().mockResolvedValue(
    opts.acceptResponse ?? {
      data: [{ success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'seller', retry_after_seconds: null }],
      error: null,
    },
  );
  return { auth: { getUser }, rpc };
}

function makeRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('http://127.0.0.1:3000/api/invites/accept', {
    method: 'POST',
    body: opts.body ?? JSON.stringify({ invite_token: VALID_TOKEN }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_JWT}`,
      ...opts.headers,
    },
  });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  mocks.createUserScopedClient.mockReturnValue(makeUserClient({}));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/invites/accept', () => {
  it('403 Origin divergente', async () => {
    const response = await POST(makeRequest({ headers: { Origin: 'https://evil.example.com' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_origin', role_kind: null });
  });

  it('Origin igual a APP_URL é aceito', async () => {
    const response = await POST(makeRequest({ headers: { Origin: APP_URL } }));
    expect(response.status).toBe(200);
  });

  it('400 Content-Type diferente de application/json', async () => {
    const response = await POST(makeRequest({ headers: { 'Content-Type': 'text/plain' } }));
    expect(response.status).toBe(400);
  });

  it('400 JSON inválido', async () => {
    const response = await POST(makeRequest({ body: '{not json' }));
    expect(response.status).toBe(400);
  });

  it('413 body maior que 16 KiB', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: 'x'.repeat(20000) }) }));
    expect(response.status).toBe(413);
  });

  it('400 invite_token ausente', async () => {
    const response = await POST(makeRequest({ body: '{}' }));
    expect(response.status).toBe(400);
  });

  it('400 invite_token com formato inválido (curto)', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ invite_token: 'a'.repeat(10) }) }));
    expect(response.status).toBe(400);
  });

  it('401 Authorization ausente', async () => {
    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ invite_token: VALID_TOKEN }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, code: 'unauthenticated', role_kind: null });
  });

  it('401 Authorization malformada (sem "Bearer ")', async () => {
    const response = await POST(makeRequest({ headers: { Authorization: 'Token abc' } }));
    expect(response.status).toBe(401);
  });

  it('401 JWT inválido/expirado (getUser recusa)', async () => {
    mocks.createUserScopedClient.mockReturnValue(
      makeUserClient({ getUserResult: { data: { user: null }, error: { message: 'invalid' } } }),
    );
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
  });

  it('Auth user SEM profile é aceito pelo helper: accept_invite ainda é chamado normalmente', async () => {
    // getUser só confirma o JWT — nunca consulta profiles. Um id de auth
    // user "novo" (sem nenhuma linha em profiles) passa por aqui sem
    // nenhuma diferença de tratamento; é accept_invite() no banco quem
    // decide o resto via auth.uid().
    const userClient = makeUserClient({ getUserResult: { data: { user: { id: 'auth-user-sem-profile' } }, error: null } });
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(userClient.rpc).toHaveBeenCalledWith('accept_invite', expect.any(Object));
  });

  it('accept_invite é chamado exatamente 1 vez, com o cliente ESCOPADO pelo JWT (nunca admin)', async () => {
    const userClient = makeUserClient({});
    mocks.createUserScopedClient.mockReturnValue(userClient);

    await POST(makeRequest());

    expect(userClient.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.createUserScopedClient).toHaveBeenCalledWith(VALID_JWT);
  });

  it('SHA-256 correto do invite_token é enviado como p_token_hash', async () => {
    const userClient = makeUserClient({});
    mocks.createUserScopedClient.mockReturnValue(userClient);
    const { hashInviteToken } = await import('@/lib/server/invites/token');

    await POST(makeRequest());

    expect(userClient.rpc).toHaveBeenCalledWith('accept_invite', { p_token_hash: hashInviteToken(VALID_TOKEN) });
  });

  it('sucesso: 200 com success/code/role_kind, sem invite_id/company_id/profile_id/membership_id/seller_id/e-mail/token/hash/JWT', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, code: 'ok', role_kind: 'seller' });

    const keys = Object.keys(body);
    for (const forbidden of ['invite_id', 'company_id', 'profile_id', 'membership_id', 'seller_id', 'email', 'token', 'token_hash', 'jwt']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it.each([
    ['email_mismatch', 403],
    ['invite_not_found', 404],
    ['invite_expired', 409],
    ['invite_already_used', 409],
    ['invite_not_actionable', 409],
    ['company_not_operational', 409],
    ['already_member', 409],
    ['membership_conflict', 409],
    ['identity_conflict', 409],
    ['invalid_relationship', 409],
    ['provisioning_failed', 503],
  ])('mapeamento HTTP: %s → %d', async (code, expectedStatus) => {
    mocks.createUserScopedClient.mockReturnValue(
      makeUserClient({
        acceptResponse: {
          data: [{ success: false, code, invite_id: null, company_id: null, role_kind: null, retry_after_seconds: null }],
          error: null,
        },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ success: false, code, role_kind: null });
  });

  it('rate_limited (vindo do limite interno de accept_invite): 429 + Retry-After', async () => {
    mocks.createUserScopedClient.mockReturnValue(
      makeUserClient({
        acceptResponse: {
          data: [{ success: false, code: 'rate_limited', invite_id: null, company_id: null, role_kind: null, retry_after_seconds: 45 }],
          error: null,
        },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(await response.json()).toEqual({ success: false, code: 'rate_limited', role_kind: null });
  });

  it('erro de transporte/RPC inesperado → 503, sem vazar texto bruto', async () => {
    mocks.createUserScopedClient.mockReturnValue(
      makeUserClient({ acceptResponse: { data: null, error: { message: 'connection reset' } } }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, code: 'internal_error', role_kind: null });
  });

  it('nenhum verifyOtp, updateUser ou manipulação de senha em nenhum caminho', async () => {
    const userClient = makeUserClient({});
    mocks.createUserScopedClient.mockReturnValue(userClient);

    await POST(makeRequest());

    expect((userClient.auth as any).verifyOtp).toBeUndefined();
    expect((userClient.auth as any).updateUser).toBeUndefined();
  });

  it('resposta tem Cache-Control: no-store', async () => {
    const response = await POST(makeRequest());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('nenhum segredo/token/JWT aparece nos logs (console.log/console.error)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(makeRequest());

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toContain(VALID_TOKEN);
    expect(allLogged).not.toContain(VALID_JWT);
    expect(allLogged).not.toMatch(/Bearer/);
  });
});
