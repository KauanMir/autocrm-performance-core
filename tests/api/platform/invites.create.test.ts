// tests/api/platform/invites.create.test.ts — Route Handler de criação de
// convites (M1-F S4-A2B/S4-A2B.1, design §15/§16/§22). Clientes Supabase
// mockados nas fábricas — nenhuma rede real, nenhum Supabase local
// necessário.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createAnonServerClient: vi.fn(),
  createUserScopedClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/server/supabase/user-token-client', () => ({
  createAnonServerClient: mocks.createAnonServerClient,
  createUserScopedClient: mocks.createUserScopedClient,
}));

import { POST } from '@/app/api/platform/invites/route';

const APP_URL = 'http://127.0.0.1:3000';
const VALID_JWT = 'valid-jwt-token';
const ACTOR_ID = 'actor-profile-1';

function makeAdmin(opts: {
  reserveResponse?: { data: unknown; error: unknown };
  createInviteResponses?: Array<{ data: unknown; error: unknown }>;
  fromDeliveryStatus?: string;
}) {
  const reserveResponse = opts.reserveResponse ?? { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
  const createInviteQueue = [...(opts.createInviteResponses ?? [])];
  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_create_invite_rate_limit') {
      return Promise.resolve(reserveResponse);
    }
    if (name === 'reserve_invite_rate_limit') {
      throw new Error('helper genérico não deveria ser chamado diretamente pelo Route Handler');
    }
    if (name === 'create_invite') {
      const next = createInviteQueue.length > 1 ? createInviteQueue.shift() : createInviteQueue[0];
      return Promise.resolve(next);
    }
    if (name === 'complete_invite_delivery') {
      return Promise.resolve({ data: [{ success: true, code: 'ok' }], error: null });
    }
    throw new Error(`unexpected rpc: ${name}`);
  });

  const limit = vi.fn().mockResolvedValue({
    data: opts.fromDeliveryStatus !== undefined ? [{ delivery_status: opts.fromDeliveryStatus }] : [],
    error: null,
  });
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return { rpc, from, auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: null }) } } };
}

function makeAnon(signInWithOtpResult: { error: unknown } = { error: null }) {
  return { auth: { signInWithOtp: vi.fn().mockResolvedValue(signInWithOtpResult) } };
}

function makeUserScopedClient(opts: { userId?: string; getUserError?: unknown } = {}) {
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserError
      ? { data: { user: null }, error: opts.getUserError }
      : { data: { user: { id: opts.userId ?? ACTOR_ID } }, error: null },
  );
  return { auth: { getUser } };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company_id: null,
    email: 'convidado@example.com',
    name: 'Fulano de Tal',
    role_kind: 'super_admin',
    ...overrides,
  };
}

function makeRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('http://127.0.0.1:3000/api/platform/invites', {
    method: 'POST',
    body: opts.body ?? JSON.stringify(validBody()),
    headers: {
      Authorization: `Bearer ${VALID_JWT}`,
      ...opts.headers,
    },
  });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  mocks.createUserScopedClient.mockReturnValue(makeUserScopedClient());
  mocks.createAnonServerClient.mockReturnValue(makeAnon());
  mocks.createAdminClient.mockReturnValue(
    makeAdmin({ createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }] }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/platform/invites', () => {
  it('401 sem Authorization', async () => {
    const request = new Request('http://127.0.0.1:3000/api/platform/invites', {
      method: 'POST',
      body: JSON.stringify(validBody()),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, code: 'unauthenticated' });
  });

  it('401 JWT inválido (getUser recusa)', async () => {
    mocks.createUserScopedClient.mockReturnValue(makeUserScopedClient({ getUserError: { message: 'invalid' } }));
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
  });

  it('403 Origin inválido', async () => {
    const response = await POST(makeRequest({ headers: { Origin: 'https://evil.example.com' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_origin' });
  });

  it('Origin igual a APP_URL é aceito', async () => {
    const response = await POST(makeRequest({ headers: { Origin: APP_URL } }));
    expect(response.status).toBe(201);
  });

  it('400 body malformado (campo faltando)', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify({ email: 'a@b.com' }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_body' });
  });

  it('400 role_kind inválido', async () => {
    const response = await POST(makeRequest({ body: JSON.stringify(validBody({ role_kind: 'ceo' })) }));
    expect(response.status).toBe(400);
  });

  it('413 body maior que 16 KiB', async () => {
    const response = await POST(makeRequest({ body: 'x'.repeat(20000) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ success: false, code: 'body_too_large' });
  });

  it('chama reserve_create_invite_rate_limit com actor/company_id/email/role_kind', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    await POST(makeRequest());

    expect(admin.rpc).toHaveBeenCalledWith('reserve_create_invite_rate_limit', {
      p_actor_profile_id: ACTOR_ID,
      p_company_id: null,
      p_email: 'convidado@example.com',
      p_role_kind: 'super_admin',
    });
  });

  it('NUNCA chama o helper genérico reserve_invite_rate_limit diretamente', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'reserve_invite_rate_limit')).toBe(false);
  });

  it('429 rate limit com Retry-After', async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdmin({ reserveResponse: { data: [{ allowed: false, code: 'actor_rate_limited', retry_after_seconds: 120 }], error: null } }),
    );
    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(await response.json()).toEqual({ success: false, code: 'rate_limited' });
  });

  it('Seller (sem autorização): reserve_create_invite_rate_limit RPC raises → 403, nunca chama create_invite (não consome reserva)', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: null, error: { message: 'insufficient_privilege' } },
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'forbidden' });
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'create_invite')).toBe(false);
  });

  it('Manager inativo: reserve_create_invite_rate_limit RPC raises → 403, nunca chama create_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: null, error: { message: 'insufficient_privilege' } },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest({ body: JSON.stringify(validBody({ company_id: '123e4567-e89b-12d3-a456-426614174000', role_kind: 'seller' })) }));

    expect(response.status).toBe(403);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'create_invite')).toBe(false);
  });

  it('tentativa de convite de plataforma sem ser Super Admin: RPC raises → 403, nunca chama create_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: null, error: { message: 'insufficient_privilege' } },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest({ body: JSON.stringify(validBody({ company_id: null, role_kind: 'super_admin' })) }));

    expect(response.status).toBe(403);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'create_invite')).toBe(false);
  });

  it('falha de domínio detectada na RESERVA (already_member) → 409, nunca chama create_invite nem Auth', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: [{ allowed: false, code: 'already_member', retry_after_seconds: null }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'already_member' });
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'create_invite')).toBe(false);
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('falha de domínio (already_member) detectada em create_invite (TOCTOU raro) → 409, nunca chama Auth', async () => {
    const admin = makeAdmin({ createInviteResponses: [{ data: [{ success: false, code: 'already_member' }], error: null }] });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'already_member' });
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('operação autorizada: reserve_create_invite_rate_limit é chamado EXATAMENTE 1 vez', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    const reserveCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'reserve_create_invite_rate_limit');
    expect(reserveCalls).toHaveLength(1);
  });

  it('token_conflict: tenta novamente e sucede na 2ª tentativa (sem nova reserva de rate limit)', async () => {
    const admin = makeAdmin({
      createInviteResponses: [
        { data: [{ success: false, code: 'token_conflict' }], error: null },
        { data: [{ success: true, code: 'ok', invite_id: 'invite-2', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    const createCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'create_invite');
    expect(createCalls).toHaveLength(2);
    const reserveCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'reserve_create_invite_rate_limit');
    expect(reserveCalls).toHaveLength(1);
  });

  it('token_conflict esgotado (3 tentativas) → 409 token_conflict, reserva ainda assim só 1 vez', async () => {
    const admin = makeAdmin({
      createInviteResponses: [
        { data: [{ success: false, code: 'token_conflict' }], error: null },
        { data: [{ success: false, code: 'token_conflict' }], error: null },
        { data: [{ success: false, code: 'token_conflict' }], error: null },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'token_conflict' });
    const reserveCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'reserve_create_invite_rate_limit');
    expect(reserveCalls).toHaveLength(1);
  });

  it('usuário novo: 201, sem chamar signInWithOtp', async () => {
    const anon = makeAnon();
    mocks.createAnonServerClient.mockReturnValue(anon);

    const response = await POST(makeRequest());

    expect(response.status).toBe(201);
    expect(anon.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('usuário existente (email_exists): 201, mesma forma de resposta que usuário novo', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    admin.auth.admin.inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'email_exists' } });
    mocks.createAdminClient.mockReturnValue(admin);
    const anon = makeAnon({ error: null });
    mocks.createAnonServerClient.mockReturnValue(anon);

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(anon.auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      success: true,
      code: 'ok',
      invite_id: 'invite-1',
      status: 'pending',
      delivery_status: 'sent',
      expires_at: '2026-08-01T00:00:00Z',
    });
  });

  it('nenhum campo de diferenciação novo/existente aparece no corpo da resposta', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();
    const keys = Object.keys(body);
    for (const forbidden of ['user_created', 'user_exists', 'magic_link', 'invite_link', 'auth_user_id']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('falha Auth (inviteUserByEmail falha, não email_exists) → 502 delivery_failed', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    admin.auth.admin.inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'unexpected_failure', status: 500 } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ success: false, code: 'delivery_failed', invite_id: 'invite-1', delivery_status: 'failed' });
  });

  it('falha Auth por indisponibilidade (AuthRetryableFetchError) → 503 auth_unavailable', async () => {
    const admin = makeAdmin({
      createInviteResponses: [{ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null }],
    });
    admin.auth.admin.inviteUserByEmail = vi.fn().mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 503 } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await POST(makeRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('auth_unavailable');
  });

  it('finalização falha (RPC de finalização com erro de transporte 2x e linha continua not_sent) → 503 delivery_finalize_failed', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'reserve_create_invite_rate_limit') {
        return Promise.resolve({ data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null });
      }
      if (name === 'create_invite') {
        return Promise.resolve({ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'pending', expires_at: '2026-08-01T00:00:00Z' }], error: null });
      }
      if (name === 'complete_invite_delivery') {
        return Promise.resolve({ data: null, error: { message: 'transport error' } });
      }
      throw new Error(`unexpected rpc: ${name}`);
    });
    const limit = vi.fn().mockResolvedValue({ data: [{ delivery_status: 'not_sent' }], error: null });
    const eq = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    mocks.createAdminClient.mockReturnValue({
      rpc,
      from,
      auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: null }) } },
    });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ success: false, code: 'delivery_finalize_failed', invite_id: 'invite-1' });
  });

  it('sucesso: 201 com corpo exato, sem token/hash/link', async () => {
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      success: true,
      code: 'ok',
      invite_id: 'invite-1',
      status: 'pending',
      delivery_status: 'sent',
      expires_at: '2026-08-01T00:00:00Z',
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/invite_token/);
    expect(serialized).not.toMatch(/token_hash/);
    expect(serialized).not.toMatch(/redirect/i);
    expect(serialized).not.toContain('convite/aceitar');
  });

  it('resposta HTTP tem Cache-Control: no-store', async () => {
    const response = await POST(makeRequest());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('nenhum segredo aparece nos logs (console.log/console.error)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(makeRequest());

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toMatch(/Bearer/);
    expect(allLogged).not.toContain(VALID_JWT);
    expect(allLogged).not.toContain('convidado@example.com');
    expect(allLogged).not.toContain('convite/aceitar');
  });
});
