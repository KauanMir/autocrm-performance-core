// tests/hooks/useReactivateMembership.test.tsx — mutation de reativação
// empresarial (M1-F S6-F). reactivateMembershipRpc mockado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useReactivateMembership,
  REACTIVATE_MEMBERSHIP_LOCAL_ERRORS,
  getReactivateMembershipErrorMessage,
} from '@/lib/hooks/useReactivateMembership';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';

const mocks = vi.hoisted(() => ({ reactivateMembershipRpc: vi.fn() }));

vi.mock('@/lib/membershipLifecycle/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/membershipLifecycle/repository')>();
  return { ...actual, reactivateMembershipRpc: mocks.reactivateMembershipRpc };
});

const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const RESULT = {
  membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: 'company-1',
  company_role: 'seller' as const, lifecycle_status: 'active' as const, is_active: true,
  seller_id: 'seller-1', seller_active: true,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.reactivateMembershipRpc.mockReset();
  mocks.reactivateMembershipRpc.mockResolvedValue(RESULT);
});

describe('useReactivateMembership — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID }))
      .rejects.toThrow(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
    expect(mocks.reactivateMembershipRpc).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: null, authorized: true }), { wrapper });
    await expect(result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID }))
      .rejects.toThrow(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.missingUser);
  });

  it('membershipId inválido: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.reactivateMembership({ membershipId: 'nao-e-uuid' }))
      .rejects.toThrow(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.invalidTarget);
  });
});

describe('useReactivateMembership — motivo opcional', () => {
  it('sem motivo: chama a RPC com note=null', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID });
    expect(mocks.reactivateMembershipRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, null);
  });

  it('motivo só com espaços: tratado como ausente (null)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID, note: '   ' });
    expect(mocks.reactivateMembershipRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, null);
  });

  it('motivo presente: chama a RPC com o texto trimado', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID, note: '  motivo  ' });
    expect(mocks.reactivateMembershipRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, 'motivo');
  });
});

describe('useReactivateMembership — resultado da RPC', () => {
  it('erro de domínio (membership_lifecycle_conflict): propaga, nunca embrulha', async () => {
    mocks.reactivateMembershipRpc.mockRejectedValue(new Error('membership_lifecycle_conflict'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID }))
      .rejects.toThrow('membership_lifecycle_conflict');
  });
});

describe('useReactivateMembership — invalidação de cache', () => {
  it('sucesso: invalida usuários ativos E inativos do userId', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inactiveCompanyUserQueryKeys.root('user-1') });
  });
});

describe('useReactivateMembership — isolamento por identidade', () => {
  it('identidade muda durante a chamada: resultado descartado', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.reactivateMembershipRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return RESULT;
    });
    const { result } = renderHook(() => useReactivateMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.reactivateMembership({ membershipId: MEMBERSHIP_ID }))
      .rejects.toThrow(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getReactivateMembershipErrorMessage', () => {
  it('mapeia erros de domínio para mensagens estáveis', () => {
    expect(getReactivateMembershipErrorMessage(new Error('unauthenticated'))).toBe('Sua sessão expirou. Entre novamente.');
    expect(getReactivateMembershipErrorMessage(new Error('membership_lifecycle_conflict'))).toMatch(/desligado/);
    expect(getReactivateMembershipErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getReactivateMembershipErrorMessage(new Error('P0001'))).not.toMatch(/P0001/);
    expect(getReactivateMembershipErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível reativar o usuário. Tente novamente.');
  });
});
