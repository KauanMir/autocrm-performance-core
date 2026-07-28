// tests/hooks/useOffboardSeller.test.tsx — mutation de desligamento de
// Seller (M1-F S6-F, RPC endurecida em S6-E2). offboardSellerRpc mockado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useOffboardSeller,
  OFFBOARD_SELLER_LOCAL_ERRORS,
  getOffboardSellerErrorMessage,
} from '@/lib/hooks/useOffboardSeller';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';

const mocks = vi.hoisted(() => ({ offboardSellerRpc: vi.fn() }));

vi.mock('@/lib/membershipLifecycle/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/membershipLifecycle/repository')>();
  return { ...actual, offboardSellerRpc: mocks.offboardSellerRpc };
});

const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const SUCCESSOR_MEMBERSHIP_ID = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e';

function buildResult(leadsReassigned: number) {
  return {
    membership_id: MEMBERSHIP_ID, profile_id: 'profile-1', company_id: 'company-1',
    company_role: 'seller' as const, lifecycle_status: 'offboarded' as const, is_active: false,
    seller_id: 'seller-1', seller_active: false, successor_seller_id: 'seller-2', leads_reassigned: leadsReassigned,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.offboardSellerRpc.mockReset();
  mocks.offboardSellerRpc.mockResolvedValue(buildResult(0));
});

describe('useOffboardSeller — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: null, note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_SELLER_LOCAL_ERRORS.notAllowed);
    expect(mocks.offboardSellerRpc).not.toHaveBeenCalled();
  });

  it('sellerMembershipId inválido: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: 'nao-e-uuid', successorMembershipId: null, note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_SELLER_LOCAL_ERRORS.invalidTarget);
  });

  it('successorMembershipId inválido (não-UUID, não-null): rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: 'nao-e-uuid', note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_SELLER_LOCAL_ERRORS.invalidSuccessor);
  });

  it('motivo vazio: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: null, note: '' }))
      .rejects.toThrow(OFFBOARD_SELLER_LOCAL_ERRORS.blankNote);
  });
});

describe('useOffboardSeller — resultado da RPC', () => {
  it('sucesso: chama offboardSellerRpc com membership_id do sucessor (nunca seller_id)', async () => {
    mocks.offboardSellerRpc.mockResolvedValue(buildResult(2));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: SUCCESSOR_MEMBERSHIP_ID, note: 'motivo válido' });
    expect(mocks.offboardSellerRpc).toHaveBeenCalledWith(MEMBERSHIP_ID, SUCCESSOR_MEMBERSHIP_ID, 'motivo válido');
  });

  it('erro de domínio (successor_required, novo em S6-E2): propaga, nunca embrulha', async () => {
    mocks.offboardSellerRpc.mockRejectedValue(new Error('successor_required'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: null, note: 'motivo válido' }))
      .rejects.toThrow('successor_required');
  });
});

describe('useOffboardSeller — invalidação de cache', () => {
  it('sucesso sem reatribuição (leads_reassigned=0): invalida usuários, NUNCA leads', async () => {
    mocks.offboardSellerRpc.mockResolvedValue(buildResult(0));
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: null, note: 'motivo válido' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inactiveCompanyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-1') });
  });

  it('sucesso com reatribuição (leads_reassigned>0): TAMBÉM invalida leads da empresa de origem', async () => {
    mocks.offboardSellerRpc.mockResolvedValue(buildResult(2));
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: SUCCESSOR_MEMBERSHIP_ID, note: 'motivo válido' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-1') });
  });
});

describe('useOffboardSeller — isolamento por identidade', () => {
  it('identidade muda durante a chamada: resultado descartado', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.offboardSellerRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return buildResult(0);
    });
    const { result } = renderHook(() => useOffboardSeller({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.offboardSeller({ sellerMembershipId: MEMBERSHIP_ID, successorMembershipId: null, note: 'motivo válido' }))
      .rejects.toThrow(OFFBOARD_SELLER_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getOffboardSellerErrorMessage', () => {
  it('mapeia erros de domínio, incluindo successor_required com mensagem explicativa', () => {
    expect(getOffboardSellerErrorMessage(new Error('successor_required'))).toMatch(/leads em aberto/);
    expect(getOffboardSellerErrorMessage(new Error('successor_invalid'))).toMatch(/sucessor/i);
    expect(getOffboardSellerErrorMessage(new Error('seller_state_conflict'))).toMatch(/inconsistente/);
    expect(getOffboardSellerErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getOffboardSellerErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível desligar o vendedor. Tente novamente.');
  });
});
