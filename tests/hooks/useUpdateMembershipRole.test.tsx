// tests/hooks/useUpdateMembershipRole.test.tsx — mutation de alteração de
// papel empresarial (M1-F S5-D). updateMembershipRoleRpc mockado — nenhuma
// rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateMembershipRole,
  UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS,
  getUpdateMembershipRoleErrorMessage,
} from '@/lib/hooks/useUpdateMembershipRole';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ updateMembershipRoleRpc: vi.fn() }));

vi.mock('@/lib/users/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/users/repository')>();
  return { ...actual, updateMembershipRoleRpc: mocks.updateMembershipRoleRpc };
});

const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const COMPANY_ID = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.updateMembershipRoleRpc.mockReset();
  mocks.updateMembershipRoleRpc.mockResolvedValue({
    membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: COMPANY_ID, company_role: 'manager',
  });
});

describe('useUpdateMembershipRole — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: COMPANY_ID, role: 'manager' }))
      .rejects.toThrow(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.notAllowed);
    expect(mocks.updateMembershipRoleRpc).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: null, authorized: true }), { wrapper });
    await expect(result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: COMPANY_ID, role: 'manager' }))
      .rejects.toThrow(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.missingUser);
    expect(mocks.updateMembershipRoleRpc).not.toHaveBeenCalled();
  });

  it('membershipId ou companyId inválidos (não-UUID): rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateMembershipRole({ membershipId: 'nao-e-uuid', companyId: COMPANY_ID, role: 'manager' }))
      .rejects.toThrow(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.invalidTarget);
    await expect(result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: 'nao-e-uuid', role: 'manager' }))
      .rejects.toThrow(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.invalidTarget);
    expect(mocks.updateMembershipRoleRpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateMembershipRole — resultado da RPC', () => {
  it('sucesso: chama updateMembershipRoleRpc com os args exatos, resolve com o retorno', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: 'user-1', authorized: true }), { wrapper });
    const outcome = await result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: COMPANY_ID, role: 'manager' });
    expect(outcome).toEqual({ membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: COMPANY_ID, company_role: 'manager' });
    expect(mocks.updateMembershipRoleRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, COMPANY_ID, 'manager');
  });

  it('erro de domínio (ex.: last_manager_requires_successor): propaga, nunca embrulha', async () => {
    mocks.updateMembershipRoleRpc.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: COMPANY_ID, role: 'seller' }))
      .rejects.toThrow('last_manager_requires_successor');
  });
});

describe('useUpdateMembershipRole — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante a chamada: resultado descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.updateMembershipRoleRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return { membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: COMPANY_ID, company_role: 'manager' };
    });
    const { result } = renderHook(() => useUpdateMembershipRole({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateMembershipRole({ membershipId: MEMBERSHIP_ID, companyId: COMPANY_ID, role: 'manager' }))
      .rejects.toThrow(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getUpdateMembershipRoleErrorMessage', () => {
  it('mapeia erros de domínio para as mensagens estáveis exigidas, nunca texto bruto', () => {
    expect(getUpdateMembershipRoleErrorMessage(new Error('unauthenticated'))).toBe('Sua sessão expirou. Entre novamente.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('membership_not_found'))).toBe('Vínculo empresarial não encontrado ou indisponível.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('self_role_change_forbidden'))).toBe('Você não pode alterar o próprio cargo.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('last_manager_requires_successor'))).toBe('A empresa precisa ter outro Manager antes desta alteração.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('seller_state_conflict'))).toBe('O cadastro deste usuário está inconsistente e precisa de revisão.');
    expect(getUpdateMembershipRoleErrorMessage(new Error('P0001'))).not.toMatch(/P0001/);
    expect(getUpdateMembershipRoleErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível alterar o papel. Tente novamente.');
  });
});
