// tests/server/invites/activation.test.ts — camada de serviço dos
// endpoints públicos de validação/aceite de convite (M1-F S4-C2A). Nenhuma
// rede real: createUserScopedClient é mockado; os clientes admin/user
// escopado passados às funções puras são objetos fake.
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUserScopedClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/user-token-client', () => ({
  createUserScopedClient: mocks.createUserScopedClient,
}));

import { requireAuthenticatedUser, validateInvite, acceptInvite } from '@/lib/server/invites/activation';

describe('requireAuthenticatedUser', () => {
  it('rejeita Authorization ausente', async () => {
    const request = new Request('http://127.0.0.1:3000/api/invites/accept');
    const result = await requireAuthenticatedUser(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita header mal formado (sem "Bearer ")', async () => {
    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      headers: { Authorization: 'Token abc123' },
    });
    const result = await requireAuthenticatedUser(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita "Bearer" sem token', async () => {
    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      headers: { Authorization: 'Bearer ' },
    });
    const result = await requireAuthenticatedUser(request);
    expect(result).toEqual({ ok: false });
  });

  it('rejeita JWT que getUser recusa (inválido/expirado)', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    mocks.createUserScopedClient.mockReturnValue({ auth: { getUser } });

    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      headers: { Authorization: 'Bearer bad-jwt' },
    });
    const result = await requireAuthenticatedUser(request);

    expect(result).toEqual({ ok: false });
    expect(getUser).toHaveBeenCalledWith('bad-jwt');
  });

  it('aceita JWT válido de um Auth user SEM profile, devolvendo só o id + client escopado', async () => {
    // auth.getUser nunca consulta public.profiles — este teste confirma que
    // o helper aceita um usuário Auth puro (sem nenhuma linha em profiles)
    // sem exigir nada além de um JWT válido.
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-sem-profile' } }, error: null });
    const fakeClient = { auth: { getUser } };
    mocks.createUserScopedClient.mockReturnValue(fakeClient);

    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      headers: { Authorization: 'Bearer good-jwt' },
    });
    const result = await requireAuthenticatedUser(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user).toEqual({ id: 'auth-user-sem-profile' });
      expect(result.client).toBe(fakeClient);
      expect(result.jwt).toBe('good-jwt');
    }
    expect(mocks.createUserScopedClient).toHaveBeenCalledWith('good-jwt');
  });

  it('resultado nunca contém um campo "profileId" (diferente de requireAuthenticatedActor)', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mocks.createUserScopedClient.mockReturnValue({ auth: { getUser } });

    const request = new Request('http://127.0.0.1:3000/api/invites/accept', {
      headers: { Authorization: 'Bearer good-jwt' },
    });
    const result = await requireAuthenticatedUser(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('profileId' in result.user).toBe(false);
    }
  });
});

function fakeAdmin(rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as any;
}

describe('validateInvite', () => {
  it('chama reserve_invite_validation_rate_limit ANTES de validate_invite_token', async () => {
    const calls: string[] = [];
    const admin = fakeAdmin(async (name) => {
      calls.push(name);
      if (name === 'reserve_invite_validation_rate_limit') {
        return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      }
      if (name === 'validate_invite_token') {
        return { data: [{ valid: true, code: 'ok', masked_email: 'f***@x.com' }], error: null };
      }
      throw new Error(`unexpected rpc: ${name}`);
    });

    await validateInvite({ admin, ipHash: 'ip'.padEnd(64, '0'), tokenHash: 'tok'.padEnd(64, '0') });

    expect(calls).toEqual(['reserve_invite_validation_rate_limit', 'validate_invite_token']);
  });

  it('rate limit negado: nunca chama validate_invite_token', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') {
        return { data: [{ allowed: false, code: 'ip_rate_limited', retry_after_seconds: 120 }], error: null };
      }
      throw new Error(`não deveria chamar ${name}`);
    });

    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });

    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 120 });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it('convite válido: devolve valid=true, code e masked_email', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') {
        return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      }
      return { data: [{ valid: true, code: 'ok', masked_email: 'f***@x.com' }], error: null };
    });

    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });

    expect(result).toEqual({ outcome: 'checked', valid: true, code: 'ok', maskedEmail: 'f***@x.com' });
  });

  it('convite inválido: masked_email nunca aparece mesmo que a RPC devolva algo', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') {
        return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      }
      return { data: [{ valid: false, code: 'invite_expired', masked_email: 'vazamento@x.com' }], error: null };
    });

    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });

    expect(result).toEqual({ outcome: 'checked', valid: false, code: 'invite_expired', maskedEmail: null });
  });

  it('erro de transporte na reserva → outcome error', async () => {
    const admin = fakeAdmin(async () => ({ data: null, error: { message: 'transport' } }));
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('erro de transporte na validação → outcome error', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') {
        return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      }
      return { data: null, error: { message: 'transport' } };
    });
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('reserva com array vazio → outcome error (falha fechado, nunca assume linha ausente como sucesso)', async () => {
    const admin = fakeAdmin(async () => ({ data: [], error: null }));
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('reserva com múltiplas linhas (forma inesperada) → outcome error, nunca assume a primeira silenciosamente', async () => {
    const admin = fakeAdmin(async () => ({
      data: [
        { allowed: true, code: 'ok', retry_after_seconds: 0 },
        { allowed: true, code: 'ok', retry_after_seconds: 0 },
      ],
      error: null,
    }));
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('reserva com allowed de tipo incorreto (não-boolean) → outcome error', async () => {
    const admin = fakeAdmin(async () => ({ data: [{ allowed: 'sim', code: 'ok', retry_after_seconds: 0 }], error: null }));
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('rate limited com retry_after_seconds negativo/inválido cai no default seguro (60), nunca propaga negativo', async () => {
    const admin = fakeAdmin(async () => ({ data: [{ allowed: false, code: 'x', retry_after_seconds: -5 }], error: null }));
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 60 });
  });

  it('validate com valid de tipo incorreto → outcome error', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      return { data: [{ valid: 'true', code: 'ok', masked_email: null }], error: null };
    });
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('validate com valid=true mas masked_email de tipo incorreto → outcome error (falha fechado)', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      return { data: [{ valid: true, code: 'ok', masked_email: 12345 }], error: null };
    });
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('validate com múltiplas linhas → outcome error', async () => {
    const admin = fakeAdmin(async (name) => {
      if (name === 'reserve_invite_validation_rate_limit') return { data: [{ allowed: true, code: 'ok', retry_after_seconds: 0 }], error: null };
      return {
        data: [
          { valid: true, code: 'ok', masked_email: 'a***@x.com' },
          { valid: false, code: 'invite_expired', masked_email: null },
        ],
        error: null,
      };
    });
    const result = await validateInvite({ admin, ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });
});

function fakeUserClient(rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as any;
}

describe('acceptInvite', () => {
  it('chama accept_invite exatamente uma vez, com p_token_hash', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'seller', retry_after_seconds: null }],
      error: null,
    }));

    await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });

    expect(userClient.rpc).toHaveBeenCalledTimes(1);
    expect(userClient.rpc).toHaveBeenCalledWith('accept_invite', { p_token_hash: 'x'.repeat(64) });
  });

  it('sucesso: devolve success/code/roleKind', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'manager', retry_after_seconds: null }],
      error: null,
    }));

    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });

    expect(result).toEqual({ outcome: 'checked', success: true, code: 'ok', roleKind: 'manager', retryAfterSeconds: null });
  });

  it('falha de domínio: roleKind sempre null mesmo que a RPC devolva algo', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: false, code: 'membership_conflict', invite_id: 'i1', company_id: 'c1', role_kind: 'seller', retry_after_seconds: null }],
      error: null,
    }));

    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });

    expect(result).toEqual({ outcome: 'checked', success: false, code: 'membership_conflict', roleKind: null, retryAfterSeconds: null });
  });

  it('rate_limited: expõe retryAfterSeconds', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: false, code: 'rate_limited', invite_id: null, company_id: null, role_kind: null, retry_after_seconds: 90 }],
      error: null,
    }));

    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });

    expect(result).toEqual({ outcome: 'checked', success: false, code: 'rate_limited', roleKind: null, retryAfterSeconds: 90 });
  });

  it('erro de transporte → outcome error', async () => {
    const userClient = fakeUserClient(async () => ({ data: null, error: { message: 'transport' } }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('array vazio → outcome error', async () => {
    const userClient = fakeUserClient(async () => ({ data: [], error: null }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('múltiplas linhas → outcome error, nunca assume a primeira', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [
        { success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'seller', retry_after_seconds: null },
        { success: false, code: 'already_member', invite_id: 'i2', company_id: 'c2', role_kind: null, retry_after_seconds: null },
      ],
      error: null,
    }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success de tipo incorreto (não-boolean) → outcome error', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: 'true', code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'seller', retry_after_seconds: null }],
      error: null,
    }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=true com role_kind inválido (fora do catálogo) → outcome error, nunca propaga', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: 'ceo', retry_after_seconds: null }],
      error: null,
    }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=true com role_kind null (forma inesperada, deveria vir sempre preenchido) → outcome error', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: true, code: 'ok', invite_id: 'i1', company_id: 'c1', role_kind: null, retry_after_seconds: null }],
      error: null,
    }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'error' });
  });

  it('rate_limited com retry_after_seconds negativo/inválido cai no default seguro (60)', async () => {
    const userClient = fakeUserClient(async () => ({
      data: [{ success: false, code: 'rate_limited', invite_id: null, company_id: null, role_kind: null, retry_after_seconds: -10 }],
      error: null,
    }));
    const result = await acceptInvite({ userClient, tokenHash: 'x'.repeat(64) });
    expect(result).toEqual({ outcome: 'checked', success: false, code: 'rate_limited', roleKind: null, retryAfterSeconds: 60 });
  });
});
