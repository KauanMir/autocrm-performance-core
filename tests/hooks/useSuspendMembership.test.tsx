// tests/hooks/useSuspendMembership.test.tsx — mutation de suspensão
// empresarial (M1-F S6-F). suspendMembershipRpc mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useSuspendMembership,
  SUSPEND_MEMBERSHIP_LOCAL_ERRORS,
  getSuspendMembershipErrorMessage,
} from '@/lib/hooks/useSuspendMembership';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';

const mocks = vi.hoisted(() => ({ suspendMembershipRpc: vi.fn() }));

vi.mock('@/lib/membershipLifecycle/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/membershipLifecycle/repository')>();
  return { ...actual, suspendMembershipRpc: mocks.suspendMembershipRpc };
});

const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const RESULT = {
  membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: 'company-1',
  company_role: 'seller' as const, lifecycle_status: 'suspended' as const, is_active: false,
  seller_id: 'seller-1', seller_active: false,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.suspendMembershipRpc.mockReset();
  mocks.suspendMembershipRpc.mockResolvedValue(RESULT);
});

describe('useSuspendMembership — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' }))
      .rejects.toThrow(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
    expect(mocks.suspendMembershipRpc).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: null, authorized: true }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' }))
      .rejects.toThrow(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.missingUser);
    expect(mocks.suspendMembershipRpc).not.toHaveBeenCalled();
  });

  it('membershipId inválido (não-UUID): rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: 'nao-e-uuid', note: 'motivo válido' }))
      .rejects.toThrow(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.invalidTarget);
    expect(mocks.suspendMembershipRpc).not.toHaveBeenCalled();
  });

  it('motivo vazio/só espaço: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: '   ' }))
      .rejects.toThrow(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.blankNote);
    expect(mocks.suspendMembershipRpc).not.toHaveBeenCalled();
  });
});

describe('useSuspendMembership — resultado da RPC', () => {
  it('sucesso: chama suspendMembershipRpc com os args exatos', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    const outcome = await result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' });
    expect(outcome).toEqual(RESULT);
    expect(mocks.suspendMembershipRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, 'motivo válido');
  });

  it('erro de domínio (ex.: last_manager_requires_successor): propaga, nunca embrulha', async () => {
    mocks.suspendMembershipRpc.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' }))
      .rejects.toThrow('last_manager_requires_successor');
  });
});

describe('useSuspendMembership — invalidação de cache', () => {
  it('sucesso: invalida usuários ativos E inativos do userId', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inactiveCompanyUserQueryKeys.root('user-1') });
  });
});

describe('useSuspendMembership — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante a chamada: resultado descartado', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.suspendMembershipRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return RESULT;
    });
    const { result } = renderHook(() => useSuspendMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.suspendMembership({ membershipId: MEMBERSHIP_ID, note: 'motivo válido' }))
      .rejects.toThrow(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getSuspendMembershipErrorMessage', () => {
  it('mapeia erros de domínio para mensagens estáveis, nunca texto bruto', () => {
    expect(getSuspendMembershipErrorMessage(new Error('unauthenticated'))).toBe('Sua sessão expirou. Entre novamente.');
    expect(getSuspendMembershipErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getSuspendMembershipErrorMessage(new Error('membership_not_found'))).toBe('Vínculo empresarial não encontrado ou indisponível.');
    expect(getSuspendMembershipErrorMessage(new Error('invalid_note'))).toMatch(/motivo/);
    expect(getSuspendMembershipErrorMessage(new Error('seller_state_conflict'))).toMatch(/inconsistente/);
    expect(getSuspendMembershipErrorMessage(new Error('last_manager_requires_successor'))).toMatch(/Manager/);
    expect(getSuspendMembershipErrorMessage(new Error('company_not_operational'))).toMatch(/empresa/);
    expect(getSuspendMembershipErrorMessage(new Error('P0001'))).not.toMatch(/P0001/);
    expect(getSuspendMembershipErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível suspender o usuário. Tente novamente.');
  });
});
