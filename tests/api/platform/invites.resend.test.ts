// tests/api/platform/invites.resend.test.ts — Route Handler de reenvio de
// convites (M1-F S4-A2B/S4-A2B.1, design §17/§22). Clientes Supabase
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

import { POST } from '@/app/api/platform/invites/[id]/resend/route';

const APP_URL = 'http://127.0.0.1:3000';
const VALID_JWT = 'valid-jwt-token';
const ACTOR_ID = 'actor-profile-1';
const INVITE_ID = '123e4567-e89b-12d3-a456-426614174000';

function makeAdmin(opts: {
  reserveResponse?: { data: unknown; error: unknown };
  resendResponses?: Array<{ data: unknown; error: unknown }>;
  fromDeliveryStatus?: string;
}) {
  const reserveResponse = opts.reserveResponse ?? { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
  const resendQueue = [...(opts.resendResponses ?? [])];
  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_resend_invite_rate_limit') {
      return Promise.resolve(reserveResponse);
    }
    if (name === 'reserve_invite_rate_limit') {
      throw new Error('helper genérico não deveria ser chamado diretamente pelo Route Handler');
    }
    if (name === 'resend_invite') {
      const next = resendQueue.length > 1 ? resendQueue.shift() : resendQueue[0];
      return Promise.resolve(next);
    }
    if (name === 'complete_invite_resend_delivery') {
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

function makeUserScopedClient(opts: {
  userId?: string;
  getUserError?: unknown;
  inviteRows?: Array<{ id: string; company_id: string | null; email: string; status: string }>;
} = {}) {
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserError
      ? { data: { user: null }, error: opts.getUserError }
      : { data: { user: { id: opts.userId ?? ACTOR_ID } }, error: null },
  );

  const defaultRows = [{ id: INVITE_ID, company_id: null, email: 'convidado@example.com', status: 'pending' }];
  const limit = vi.fn().mockResolvedValue({ data: opts.inviteRows ?? defaultRows, error: null });
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return { auth: { getUser }, from };
}

function makeRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`http://127.0.0.1:3000/api/platform/invites/${INVITE_ID}/resend`, {
    method: 'POST',
    body: opts.body ?? '',
    headers: {
      Authorization: `Bearer ${VALID_JWT}`,
      ...opts.headers,
    },
  });
}

function call(request: Request, id: string = INVITE_ID): Promise<Response> {
  return POST(request, { params: { id } });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  mocks.createUserScopedClient.mockReturnValue(makeUserScopedClient());
  mocks.createAnonServerClient.mockReturnValue(makeAnon());
  mocks.createAdminClient.mockReturnValue(
    makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/platform/invites/[id]/resend', () => {
  it('UUID inválido → 400', async () => {
    const response = await call(makeRequest(), 'not-a-uuid');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_input' });
  });

  it('401 sem Authorization', async () => {
    const request = new Request(`http://127.0.0.1:3000/api/platform/invites/${INVITE_ID}/resend`, { method: 'POST', body: '' });
    const response = await call(request);
    expect(response.status).toBe(401);
  });

  it('403 Origin inválido', async () => {
    const response = await call(makeRequest({ headers: { Origin: 'https://evil.example.com' } }));
    expect(response.status).toBe(403);
  });

  it('400 quando o body do resend tem qualquer campo', async () => {
    const response = await call(makeRequest({ body: JSON.stringify({ foo: 'bar' }) }));
    expect(response.status).toBe(400);
  });

  it('body vazio (string vazia) é aceito como {}', async () => {
    const response = await call(makeRequest({ body: '' }));
    expect(response.status).toBe(200);
  });

  it('invite não encontrado pela RLS → invite_not_found genérico (não revela detalhe)', async () => {
    mocks.createUserScopedClient.mockReturnValue(makeUserScopedClient({ inviteRows: [] }));
    const response = await call(makeRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, code: 'invite_not_found' });
  });

  it('RLS impede convite alheio: SELECT filtrado retorna vazio → mesmo invite_not_found genérico', async () => {
    // A RLS de invites já restringe a visibilidade a is_platform_super_admin()
    // OR invited_by_profile_id = auth.uid() — um Manager que não é o
    // convidador original recebe 0 linhas do próprio Postgres, nunca um
    // "403 forbidden" que revelaria a existência do convite.
    mocks.createUserScopedClient.mockReturnValue(makeUserScopedClient({ inviteRows: [] }));
    const response = await call(makeRequest());
    expect(response.status).toBe(404);
  });

  it('chama reserve_resend_invite_rate_limit com actor/invite_id, nunca com company_id/email do chamador', async () => {
    const admin = makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    await call(makeRequest());

    expect(admin.rpc).toHaveBeenCalledWith('reserve_resend_invite_rate_limit', {
      p_actor_profile_id: ACTOR_ID,
      p_invite_id: INVITE_ID,
    });
  });

  it('NUNCA chama o helper genérico reserve_invite_rate_limit diretamente', async () => {
    const admin = makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(200);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'reserve_invite_rate_limit')).toBe(false);
  });

  it('429 rate limit', async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdmin({ reserveResponse: { data: [{ allowed: false, code: 'email_scope_rate_limited', retry_after_seconds: 3600 }], error: null } }),
    );
    const response = await call(makeRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
  });

  it('Manager alheio (reserve nega com invite_not_found mesmo se a pré-checagem RLS retornasse uma linha) → 404 genérico, nunca chama resend_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: [{ allowed: false, code: 'invite_not_found', retry_after_seconds: null }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, code: 'invite_not_found' });
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'resend_invite')).toBe(false);
  });

  it('Manager com membership inativa: reserve_resend_invite_rate_limit RPC raises → 403, nunca chama resend_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: null, error: { message: 'insufficient_privilege' } },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(403);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'resend_invite')).toBe(false);
  });

  it('Seller: reserve_resend_invite_rate_limit RPC raises → 403, nunca chama resend_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: null, error: { message: 'insufficient_privilege' } },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(403);
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'resend_invite')).toBe(false);
  });

  it('convite não elegível (canceled/superseded/accepted) detectado na RESERVA → 409, nunca chama resend_invite', async () => {
    const admin = makeAdmin({
      reserveResponse: { data: [{ allowed: false, code: 'invite_not_actionable', retry_after_seconds: null }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'invite_not_actionable' });
    expect(admin.rpc.mock.calls.some((c) => c[0] === 'resend_invite')).toBe(false);
  });

  it('operação autorizada: reserve_resend_invite_rate_limit é chamado EXATAMENTE 1 vez', async () => {
    const admin = makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(200);
    const reserveCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'reserve_resend_invite_rate_limit');
    expect(reserveCalls).toHaveLength(1);
  });

  it('token_conflict: retry e sucesso na 2ª tentativa (sem nova reserva)', async () => {
    const admin = makeAdmin({
      resendResponses: [
        { data: [{ success: false, code: 'token_conflict' }], error: null },
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());
    expect(response.status).toBe(200);

    const resendCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'resend_invite');
    expect(resendCalls).toHaveLength(2);
    const reserveCalls = admin.rpc.mock.calls.filter((c) => c[0] === 'reserve_resend_invite_rate_limit');
    expect(reserveCalls).toHaveLength(1);
  });

  it('usuário novo: 200, sem chamar signInWithOtp', async () => {
    const anon = makeAnon();
    mocks.createAnonServerClient.mockReturnValue(anon);

    const response = await call(makeRequest());
    expect(response.status).toBe(200);
    expect(anon.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('usuário existente (email_exists): 200 com previous_invite_id correto', async () => {
    const admin = makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    admin.auth.admin.inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'email_exists' } });
    mocks.createAdminClient.mockReturnValue(admin);
    const anon = makeAnon({ error: null });
    mocks.createAnonServerClient.mockReturnValue(anon);

    const response = await call(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(anon.auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      success: true,
      code: 'ok',
      invite_id: 'new-invite',
      previous_invite_id: INVITE_ID,
      status: 'pending',
      delivery_status: 'sent',
      expires_at: '2026-08-01T00:00:00Z',
    });
  });

  it('falha Auth → 502 delivery_failed com previous_invite_id', async () => {
    const admin = makeAdmin({
      resendResponses: [
        {
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        },
      ],
    });
    admin.auth.admin.inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'unexpected_failure', status: 500 } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      success: false,
      code: 'delivery_failed',
      invite_id: 'new-invite',
      previous_invite_id: INVITE_ID,
      delivery_status: 'failed',
    });
  });

  it('falha da finalização → 503 delivery_finalize_failed', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'reserve_resend_invite_rate_limit') {
        return Promise.resolve({ data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null });
      }
      if (name === 'resend_invite') {
        return Promise.resolve({
          data: [{ success: true, code: 'ok', invite_id: 'new-invite', previous_invite_id: INVITE_ID, status: 'pending', expires_at: '2026-08-01T00:00:00Z' }],
          error: null,
        });
      }
      if (name === 'complete_invite_resend_delivery') {
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

    const response = await call(makeRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      code: 'delivery_finalize_failed',
      invite_id: 'new-invite',
      previous_invite_id: INVITE_ID,
    });
  });

  it('sucesso: 200 sem token/hash/link no corpo', async () => {
    const response = await call(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/invite_token/);
    expect(serialized).not.toMatch(/token_hash/);
    expect(serialized).not.toContain('convite/aceitar');
  });

  it('nenhum dado sensível nos logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await call(makeRequest());

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toMatch(/Bearer/);
    expect(allLogged).not.toContain(VALID_JWT);
    expect(allLogged).not.toContain('convidado@example.com');
  });
});
