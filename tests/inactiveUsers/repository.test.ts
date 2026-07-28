// tests/inactiveUsers/repository.test.ts — camada de dados da leitura
// administrativa de memberships inativas (M1-F S6-E). supabase.rpc mockado —
// nenhuma rede real. A autorização/paginação/regras de negócio reais são
// cobertas pelo teste SQL 38; aqui só o wrapper client-safe (nome exato da
// RPC, argumentos exatos, validação de forma da resposta). Mesmo padrão de
// tests/users/repository.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

import { fetchInactiveCompanyUsers } from '@/lib/inactiveUsers/repository';
import { isInactiveCompanyUserError } from '@/lib/inactiveUsers/errors';

const ROW = {
  profile_id: 'profile-1',
  membership_id: 'membership-1',
  name: 'Ana Silva',
  email: 'ana@test.local',
  company_id: 'company-1',
  company_name: 'Empresa A',
  company_role: 'seller' as const,
  lifecycle_status: 'suspended' as const,
  is_active: false,
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-27T10:00:00.000Z',
};

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('fetchInactiveCompanyUsers — chamada', () => {
  it('chama exclusivamente list_inactive_company_users com os 7 parâmetros nomeados', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null });

    await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });

    expect(mocks.rpc).toHaveBeenCalledWith('list_inactive_company_users', {
      p_limit: 25,
      p_cursor_updated_at: undefined,
      p_cursor_membership_id: undefined,
      p_search: undefined,
      p_company_id: undefined,
      p_role: undefined,
      p_lifecycle: undefined,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('cursor presente: envia p_cursor_updated_at/p_cursor_membership_id juntos (nunca p_cursor_created_at)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await fetchInactiveCompanyUsers({
      limit: 25,
      cursor: { updatedAt: '2026-07-01T00:00:00.000Z', membershipId: 'membership-9' },
      search: 'ana',
      companyId: 'company-1',
      role: 'seller',
      lifecycle: 'suspended',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('list_inactive_company_users', {
      p_limit: 25,
      p_cursor_updated_at: '2026-07-01T00:00:00.000Z',
      p_cursor_membership_id: 'membership-9',
      p_search: 'ana',
      p_company_id: 'company-1',
      p_role: 'seller',
      p_lifecycle: 'suspended',
    });
  });

  it('nunca usa SELECT direto — só rpc() é chamado no client mockado', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });
    expect(mocks.rpc).toHaveBeenCalled();
  });
});

describe('fetchInactiveCompanyUsers — sucesso e validação de forma', () => {
  it('retorna as linhas exatamente como vieram (nenhuma transformação)', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null });
    const result = await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });
    expect(result).toEqual([ROW]);
  });

  it('resposta vazia (array vazio): retorna array vazio, nunca erro', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });
    expect(result).toEqual([]);
  });

  it('data null: trata como array vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });
    expect(result).toEqual([]);
  });

  it('linha com lifecycle_status="active": lança inactive_company_users_invalid_response, nunca confia cegamente no shape', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, lifecycle_status: 'active' }], error: null });
    await expect(
      fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null }),
    ).rejects.toMatchObject({ code: 'inactive_company_users_invalid_response' });
  });

  it('linha com company_role fora do enum fechado: lança inactive_company_users_invalid_response', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, company_role: 'admin' }], error: null });
    await expect(
      fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null }),
    ).rejects.toMatchObject({ code: 'inactive_company_users_invalid_response' });
  });

  it('linha faltando updated_at: lança inactive_company_users_invalid_response', async () => {
    const { updated_at, ...withoutUpdatedAt } = ROW;
    mocks.rpc.mockResolvedValue({ data: [withoutUpdatedAt], error: null });
    await expect(
      fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null }),
    ).rejects.toMatchObject({ code: 'inactive_company_users_invalid_response' });
  });
});

describe('fetchInactiveCompanyUsers — erro de transporte', () => {
  it('RPC retorna erro: lança InactiveCompanyUserError com code/message sanitizados, nunca a lista', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } });
    let caught: unknown;
    try {
      await fetchInactiveCompanyUsers({ limit: 25, cursor: null, search: null, companyId: null, role: null, lifecycle: null });
    } catch (err) {
      caught = err;
    }
    expect(isInactiveCompanyUserError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('inactive_company_users_fetch_failed');
    expect((caught as { detail: { code?: string; message?: string } }).detail).toEqual({
      code: '42501',
      message: 'forbidden',
    });
  });
});
