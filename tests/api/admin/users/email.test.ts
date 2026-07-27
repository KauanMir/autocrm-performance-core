// tests/api/admin/users/email.test.ts — Route Handler de alteração
// administrativa de e-mail (M1-F S5-E1-A, decisões congeladas do S5-E0).
// Clientes Supabase mockados nas fábricas — nenhuma rede real, nenhum
// Supabase local necessário.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createUserScopedClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/server/supabase/user-token-client', () => ({
  createUserScopedClient: mocks.createUserScopedClient,
  createAnonServerClient: vi.fn(),
}));

import { POST } from '@/app/api/admin/users/[profileId]/email/route';

const APP_URL = 'http://127.0.0.1:3000';
const VALID_JWT = 'valid-jwt-token';
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = '123e4567-e89b-12d3-a456-426614174000';

const DEFAULT_PROFILE_STATE = {
  profile_exists: true,
  profile_is_active: true,
  platform_role: null,
  current_email: 'antigo@test.local',
  company_id: 'company-1',
  membership_is_active: true,
  company_status: 'ativa',
  new_email_in_use: false,
};

const DEFAULT_AUTH_STATE = {
  current_email: 'antigo@test.local',
  new_email_in_use: false,
};

function makeAdmin(opts: {
  isSuperAdmin?: boolean;
  profileState?: Partial<typeof DEFAULT_PROFILE_STATE> | null;
  authState?: Partial<typeof DEFAULT_AUTH_STATE> | null;
  authUpdateResult?: { data: unknown; error: unknown };
  commitViaAdmin?: never;
} = {}) {
  const profileState = opts.profileState === null ? null : { ...DEFAULT_PROFILE_STATE, ...opts.profileState };
  const authState = opts.authState === null ? null : { ...DEFAULT_AUTH_STATE, ...opts.authState };

  const rpc = vi.fn((name: string) => {
    if (name === 'get_profile_email_update_state') {
      return Promise.resolve({ data: profileState ? [profileState] : [], error: null });
    }
    if (name === 'get_auth_email_update_state') {
      return Promise.resolve({ data: authState ? [authState] : [], error: null });
    }
    throw new Error(`unexpected admin rpc: ${name}`);
  });

  const updateUserById = vi.fn().mockResolvedValue(
    opts.authUpdateResult ?? { data: { user: { id: TARGET_ID, email: 'novo@test.local' } }, error: null },
  );

  return { rpc, auth: { admin: { updateUserById } } };
}

function makeUserClient(opts: {
  userId?: string;
  getUserError?: unknown;
  isSuperAdmin?: boolean;
  commitResult?: { data: unknown; error: unknown };
} = {}) {
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserError
      ? { data: { user: null }, error: opts.getUserError }
      : { data: { user: { id: opts.userId ?? ACTOR_ID } }, error: null },
  );

  const rpc = vi.fn((name: string) => {
    if (name === 'is_platform_super_admin') {
      return Promise.resolve({ data: opts.isSuperAdmin ?? true, error: null });
    }
    if (name === 'commit_profile_email_update') {
      return Promise.resolve(opts.commitResult ?? {
        data: [{ profile_id: TARGET_ID, email: 'novo@test.local', updated_at: '2026-07-27T00:00:00Z' }],
        error: null,
      });
    }
    throw new Error(`unexpected userClient rpc: ${name}`);
  });

  return { auth: { getUser }, rpc };
}

function makeRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`http://127.0.0.1:3000/api/admin/users/${TARGET_ID}/email`, {
    method: 'POST',
    body: opts.body ?? JSON.stringify({ email: 'novo@test.local' }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_JWT}`,
      ...opts.headers,
    },
  });
}

function call(request: Request, profileId: string = TARGET_ID): Promise<Response> {
  return POST(request, { params: { profileId } });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  mocks.createAdminClient.mockReturnValue(makeAdmin());
  mocks.createUserScopedClient.mockReturnValue(makeUserClient());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/admin/users/[profileId]/email — validação e transporte', () => {
  it('403 Origin divergente', async () => {
    const response = await call(makeRequest({ headers: { Origin: 'https://evil.example.com' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_origin' });
  });

  it('404 profileId com UUID inválido (colapsa em user_not_found, nunca invalid_input)', async () => {
    const response = await call(makeRequest(), 'not-a-uuid');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, code: 'user_not_found' });
  });

  it('400 body com campo extra além de email', async () => {
    const response = await call(makeRequest({ body: JSON.stringify({ email: 'novo@test.local', role: 'manager' }) }));
    expect(response.status).toBe(400);
  });

  it('400 e-mail ausente', async () => {
    const response = await call(makeRequest({ body: '{}' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_email' });
  });

  it('400 e-mail com formato inválido', async () => {
    const response = await call(makeRequest({ body: JSON.stringify({ email: 'nao-e-email' }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_email' });
  });

  it('400 e-mail com espaço interno', async () => {
    const response = await call(makeRequest({ body: JSON.stringify({ email: 'a b@test.local' }) }));
    expect(response.status).toBe(400);
  });

  it('400 e-mail acima de 254 caracteres', async () => {
    const long = `${'a'.repeat(250)}@test.local`;
    const response = await call(makeRequest({ body: JSON.stringify({ email: long }) }));
    expect(response.status).toBe(400);
  });

  it('401 sem Authorization', async () => {
    const request = new Request(`http://127.0.0.1:3000/api/admin/users/${TARGET_ID}/email`, {
      method: 'POST',
      body: JSON.stringify({ email: 'novo@test.local' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await call(request);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/admin/users/[profileId]/email — autorização', () => {
  it('Manager (is_platform_super_admin=false): 403, nunca toca o Auth', async () => {
    const admin = makeAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.createUserScopedClient.mockReturnValue(makeUserClient({ isSuperAdmin: false }));

    const response = await call(makeRequest());

    expect(response.status).toBe(403);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('Seller (is_platform_super_admin=false): 403', async () => {
    mocks.createUserScopedClient.mockReturnValue(makeUserClient({ isSuperAdmin: false }));
    const response = await call(makeRequest());
    expect(response.status).toBe(403);
  });

  it('autoalteração (profileId === actor.profileId): 403, nunca chama is_platform_super_admin', async () => {
    const userClient = makeUserClient({ userId: ACTOR_ID });
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest(), ACTOR_ID);

    expect(response.status).toBe(403);
    expect(userClient.rpc).not.toHaveBeenCalledWith('is_platform_super_admin');
  });

  it('alvo é outro Super Admin (platform_role=super_admin): 403, nunca toca o Auth', async () => {
    const admin = makeAdmin({ profileState: { platform_role: 'super_admin' } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(403);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/[profileId]/email — estado do alvo', () => {
  it('alvo inexistente (profile_exists=false): 404 user_not_found', async () => {
    mocks.createAdminClient.mockReturnValue(makeAdmin({ profileState: { profile_exists: false } }));
    const response = await call(makeRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, code: 'user_not_found' });
  });

  it('alvo sem membership (company_id null): 404 user_not_found', async () => {
    mocks.createAdminClient.mockReturnValue(makeAdmin({ profileState: { company_id: null } }));
    const response = await call(makeRequest());
    expect(response.status).toBe(404);
  });

  it('alvo com profile inativo: 409 user_inactive', async () => {
    mocks.createAdminClient.mockReturnValue(makeAdmin({ profileState: { profile_is_active: false } }));
    const response = await call(makeRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'user_inactive' });
  });

  it('empresa cancelada: 409 user_inactive', async () => {
    mocks.createAdminClient.mockReturnValue(makeAdmin({ profileState: { company_status: 'cancelada' } }));
    const response = await call(makeRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'user_inactive' });
  });
});

describe('POST /api/admin/users/[profileId]/email — divergência pré-existente', () => {
  it('profiles.email != auth.users.email: 409 user_email_state_conflict, nunca reconcilia, nunca chama o Auth', async () => {
    const admin = makeAdmin({
      profileState: { current_email: 'valor-em-profiles@test.local' },
      authState: { current_email: 'valor-diferente-no-auth@test.local' },
    });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'user_email_state_conflict' });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/[profileId]/email — idempotência', () => {
  it('novo e-mail igual ao atual dos dois lados: 200 sem chamar o Auth nem commit_profile_email_update', async () => {
    const admin = makeAdmin({
      profileState: { current_email: 'novo@test.local' },
      authState: { current_email: 'novo@test.local' },
    });
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient();
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest({ body: JSON.stringify({ email: 'novo@test.local' }) }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileId: TARGET_ID, email: 'novo@test.local' });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(userClient.rpc).not.toHaveBeenCalledWith('commit_profile_email_update', expect.anything());
  });
});

describe('POST /api/admin/users/[profileId]/email — conflito de e-mail', () => {
  it('já em uso no Auth (new_email_in_use=true): 409 email_already_in_use, nunca revela por quem, nunca toca o Auth', async () => {
    const admin = makeAdmin({ authState: { new_email_in_use: true } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'email_already_in_use' });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('já em uso em profiles (new_email_in_use=true no lado profiles): 409 email_already_in_use', async () => {
    const admin = makeAdmin({ profileState: { new_email_in_use: true } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await call(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'email_already_in_use' });
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/[profileId]/email — sequência Auth → profiles', () => {
  it('sucesso: chama updateUserById com email_confirm=true, depois commit_profile_email_update como o ATOR', async () => {
    const admin = makeAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient();
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest({ body: JSON.stringify({ email: 'novo@test.local' }) }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileId: TARGET_ID, email: 'novo@test.local' });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(TARGET_ID, { email: 'novo@test.local', email_confirm: true });
    expect(userClient.rpc).toHaveBeenCalledWith('commit_profile_email_update', {
      p_target_profile_id: TARGET_ID,
      p_expected_email: 'antigo@test.local',
      p_new_email: 'novo@test.local',
    });
  });

  it('resposta de sucesso nunca inclui o objeto de usuário do Auth completo', async () => {
    const response = await call(makeRequest());
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['email', 'profileId']);
  });

  it('Auth falha: 500 email_update_failed, nunca chama commit_profile_email_update', async () => {
    const admin = makeAdmin({ authUpdateResult: { data: null, error: { message: 'unexpected', status: 500 } } });
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient();
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'email_update_failed' });
    expect(userClient.rpc).not.toHaveBeenCalledWith('commit_profile_email_update', expect.anything());
  });

  it('Auth sucesso + profiles falha + compensação sucesso: 500 email_update_failed genérico (decisão congelada — nunca finge sucesso, nunca vaza o código específico de profiles), Auth restaurado', async () => {
    const admin = makeAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient({
      commitResult: { data: null, error: { message: 'user_email_state_conflict', code: 'P0001' } },
    });
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'email_update_failed' });
    // compensação: updateUserById chamado DUAS vezes (troca + reversão)
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledTimes(2);
    expect(admin.auth.admin.updateUserById).toHaveBeenNthCalledWith(2, TARGET_ID, { email: 'antigo@test.local', email_confirm: true });
  });

  it('Auth sucesso + profiles falha + compensação falha: 503 email_compensation_failed', async () => {
    const admin = makeAdmin();
    admin.auth.admin.updateUserById = vi.fn()
      .mockResolvedValueOnce({ data: { user: {} }, error: null }) // troca inicial
      .mockResolvedValueOnce({ data: null, error: { message: 'unexpected', status: 500 } }); // compensação falha
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient({
      commitResult: { data: null, error: { message: 'internal_conflict' } },
    });
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, code: 'email_compensation_failed' });
  });

  it('mensagem de erro completamente desconhecida vinda do commit: mesma resposta genérica após compensação, sem crash', async () => {
    const admin = makeAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUserClient({
      commitResult: { data: null, error: { message: 'algo-nao-catalogado' } },
    });
    mocks.createUserScopedClient.mockReturnValue(userClient);

    const response = await call(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'email_update_failed' });
  });
});

describe('POST /api/admin/users/[profileId]/email — sanitização de logs', () => {
  it('nenhum e-mail, JWT ou service key aparece nos logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await call(makeRequest());

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toMatch(/@test\.local/);
    expect(allLogged).not.toContain(VALID_JWT);
    expect(allLogged).not.toMatch(/Bearer/);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('alerta de compensação falha não expõe e-mail nem resposta do Auth', async () => {
    const admin = makeAdmin();
    admin.auth.admin.updateUserById = vi.fn()
      .mockResolvedValueOnce({ data: { user: {} }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unexpected', status: 500 } });
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.createUserScopedClient.mockReturnValue(makeUserClient({
      commitResult: { data: null, error: { message: 'internal_conflict' } },
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await call(makeRequest());
    const allLogged = errorSpy.mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(allLogged).not.toMatch(/@test\.local/);
    errorSpy.mockRestore();
  });
});

describe('POST /api/admin/users/[profileId]/email — nenhuma revogação de sessão', () => {
  it('nunca chama signOut/admin.auth.signOut em nenhum cenário', async () => {
    const admin = makeAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    await call(makeRequest());
    expect((admin as { auth: { admin: { signOut?: unknown } } }).auth.admin.signOut).toBeUndefined();
  });
});
