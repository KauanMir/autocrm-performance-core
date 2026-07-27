// tests/users/repository.test.ts — camada de dados da listagem/edição
// administrativa de usuários ativos (M1-F S5-D). supabase.rpc mockado —
// nenhuma rede real. A autorização/paginação/regras de negócio reais são
// cobertas pelos testes SQL 31/32/33; aqui só o wrapper client-safe (nomes
// exatos de RPC, argumentos exatos, validação de forma da resposta).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

import { fetchCompanyUsers, updateProfileNameRpc, updateMembershipRoleRpc } from '@/lib/users/repository';
import { isCompanyUserError } from '@/lib/users/errors';

const ROW = {
  profile_id: 'profile-1',
  membership_id: 'membership-1',
  name: 'Ana Silva',
  email: 'ana@test.local',
  company_id: 'company-1',
  company_name: 'Empresa A',
  company_role: 'seller' as const,
  created_at: '2026-07-20T10:00:00.000Z',
};

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('fetchCompanyUsers — chamada', () => {
  it('chama exclusivamente list_company_users com os 6 parâmetros nomeados', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null });

    await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });

    expect(mocks.rpc).toHaveBeenCalledWith('list_company_users', {
      p_limit: 25,
      p_cursor_created_at: undefined,
      p_cursor_membership_id: undefined,
      p_search: undefined,
      p_company_id: undefined,
      p_role: undefined,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('cursor presente: envia p_cursor_created_at/p_cursor_membership_id juntos', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await fetchCompanyUsers({
      limit: 25,
      cursor: { createdAt: '2026-07-01T00:00:00.000Z', membershipId: 'membership-9' },
      search: 'ana',
      companyId: 'company-1',
      role: 'seller',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('list_company_users', {
      p_limit: 25,
      p_cursor_created_at: '2026-07-01T00:00:00.000Z',
      p_cursor_membership_id: 'membership-9',
      p_search: 'ana',
      p_company_id: 'company-1',
      p_role: 'seller',
    });
  });

  it('nunca usa SELECT direto — só rpc() é chamado no client mockado', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });
    expect(mocks.rpc).toHaveBeenCalled();
  });
});

describe('fetchCompanyUsers — sucesso e validação de forma', () => {
  it('retorna as linhas exatamente como vieram (nenhuma transformação)', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null });
    const result = await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });
    expect(result).toEqual([ROW]);
  });

  it('resposta vazia (array vazio): retorna array vazio, nunca erro', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });
    expect(result).toEqual([]);
  });

  it('data null: trata como array vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });
    expect(result).toEqual([]);
  });

  it('linha com company_role fora do enum fechado: lança company_users_invalid_response, nunca confia cegamente no shape', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, company_role: 'admin' }], error: null });
    await expect(
      fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null }),
    ).rejects.toMatchObject({ code: 'company_users_invalid_response' });
  });

  it('linha faltando um campo obrigatório: lança company_users_invalid_response', async () => {
    const { email, ...withoutEmail } = ROW;
    mocks.rpc.mockResolvedValue({ data: [withoutEmail], error: null });
    await expect(
      fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null }),
    ).rejects.toMatchObject({ code: 'company_users_invalid_response' });
  });
});

describe('fetchCompanyUsers — erro de transporte', () => {
  it('RPC retorna erro: lança CompanyUserError com code/message sanitizados, nunca a lista', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });
    let caught: unknown;
    try {
      await fetchCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null });
    } catch (err) {
      caught = err;
    }
    expect(isCompanyUserError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('company_users_fetch_failed');
    expect((caught as { detail: { code?: string; message?: string } }).detail).toEqual({
      code: '42501',
      message: 'permission denied',
    });
  });
});

describe('updateProfileNameRpc — chamada', () => {
  it('chama exclusivamente update_profile_name com p_target_profile_id/p_name', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ profile_id: 'profile-1', name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' }],
      error: null,
    });

    await updateProfileNameRpc('profile-1', 'Ana Nova');

    expect(mocks.rpc).toHaveBeenCalledWith('update_profile_name', {
      p_target_profile_id: 'profile-1',
      p_name: 'Ana Nova',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso: retorna profile_id/name/updated_at', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ profile_id: 'profile-1', name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' }],
      error: null,
    });
    const result = await updateProfileNameRpc('profile-1', 'Ana Nova');
    expect(result).toEqual({ profile_id: 'profile-1', name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' });
  });

  it('erro de domínio (ex.: forbidden): propaga o erro CRU do PostgREST, nunca embrulha', async () => {
    const domainError = { message: 'forbidden', code: '42501' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(updateProfileNameRpc('profile-1', 'Ana Nova')).rejects.toBe(domainError);
  });

  it('resposta vazia: lança company_users_invalid_response', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(updateProfileNameRpc('profile-1', 'Ana Nova')).rejects.toMatchObject({
      code: 'company_users_invalid_response',
    });
  });
});

describe('updateMembershipRoleRpc — chamada', () => {
  it('chama exclusivamente update_membership_role com p_membership_id/p_company_id/p_role', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-1', company_role: 'manager' }],
      error: null,
    });

    await updateMembershipRoleRpc('membership-1', 'company-1', 'manager');

    expect(mocks.rpc).toHaveBeenCalledWith('update_membership_role', {
      p_membership_id: 'membership-1',
      p_company_id: 'company-1',
      p_role: 'manager',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso: retorna membership_id/profile_id/company_id/company_role', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-1', company_role: 'manager' }],
      error: null,
    });
    const result = await updateMembershipRoleRpc('membership-1', 'company-1', 'manager');
    expect(result).toEqual({
      membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-1', company_role: 'manager',
    });
  });

  it('erro de domínio (ex.: last_manager_requires_successor): propaga o erro CRU, nunca embrulha', async () => {
    const domainError = { message: 'last_manager_requires_successor', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(updateMembershipRoleRpc('membership-1', 'company-1', 'seller')).rejects.toBe(domainError);
  });

  it('resposta vazia: lança company_users_invalid_response', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(updateMembershipRoleRpc('membership-1', 'company-1', 'manager')).rejects.toMatchObject({
      code: 'company_users_invalid_response',
    });
  });
});
