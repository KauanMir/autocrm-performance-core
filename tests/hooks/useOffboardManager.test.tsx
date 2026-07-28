// tests/hooks/useOffboardManager.test.tsx — mutation de desligamento de
// Manager (M1-F S6-F, RPC de S6-C). offboardManagerRpc mockado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useOffboardManager,
  OFFBOARD_MANAGER_LOCAL_ERRORS,
  getOffboardManagerErrorMessage,
} from '@/lib/hooks/useOffboardManager';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';

const mocks = vi.hoisted(() => ({ offboardManagerRpc: vi.fn() }));

vi.mock('@/lib/membershipLifecycle/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/membershipLifecycle/repository')>();
  return { ...actual, offboardManagerRpc: mocks.offboardManagerRpc };
});

const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const SUCCESSOR_PROFILE_ID = 'c3d4e5f6-a7b8-4c5d-9e0f-1a2b3c4d5e6f';
const RESULT = {
  membership_id: MEMBERSHIP_ID, profile_id: 'profile-2', company_id: 'company-1',
  company_role: 'manager' as const, lifecycle_status: 'offboarded' as const, is_active: false,
  successor_profile_id: SUCCESSOR_PROFILE_ID,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.offboardManagerRpc.mockReset();
  mocks.offboardManagerRpc.mockResolvedValue(RESULT);
});

describe('useOffboardManager — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: null, note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_MANAGER_LOCAL_ERRORS.notAllowed);
    expect(mocks.offboardManagerRpc).not.toHaveBeenCalled();
  });

  it('successorProfileId inválido (não-UUID): rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: 'nao-e-uuid', note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_MANAGER_LOCAL_ERRORS.invalidSuccessor);
  });

  it('motivo vazio: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: null, note: '  ' }))
      .rejects.toThrow(OFFBOARD_MANAGER_LOCAL_ERRORS.blankNote);
  });
});

describe('useOffboardManager — resultado da RPC', () => {
  it('sucesso: chama offboardManagerRpc com profile_id do sucessor (nunca membership_id)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: SUCCESSOR_PROFILE_ID, note: 'motivo válido' });
    expect(mocks.offboardManagerRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, SUCCESSOR_PROFILE_ID, 'motivo válido');
  });

  it('erro de domínio (last_manager_requires_successor): propaga, nunca embrulha', async () => {
    mocks.offboardManagerRpc.mockRejectedValue(new Error('last_manager_requires_successor'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: null, note: 'motivo válido' }))
      .rejects.toThrow('last_manager_requires_successor');
  });
});

describe('useOffboardManager — invalidação de cache', () => {
  it('sucesso: invalida usuários ativos E inativos, nunca leads (offboard_manager nunca reatribui leads)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: null, note: 'motivo válido' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inactiveCompanyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});

describe('useOffboardManager — isolamento por identidade', () => {
  it('identidade muda durante a chamada: resultado descartado', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.offboardManagerRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return RESULT;
    });
    const { result } = renderHook(() => useOffboardManager({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardManager({ managerMembershipId: MEMBERSHIP_ID, successorProfileId: null, note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_MANAGER_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getOffboardManagerErrorMessage', () => {
  it('mapeia erros de domínio para mensagens estáveis', () => {
    expect(getOffboardManagerErrorMessage(new Error('successor_invalid'))).toMatch(/Manager já ativo/);
    expect(getOffboardManagerErrorMessage(new Error('last_manager_requires_successor'))).toMatch(/outro Manager ativo/);
    expect(getOffboardManagerErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getOffboardManagerErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível desligar o Manager. Tente novamente.');
  });
});
