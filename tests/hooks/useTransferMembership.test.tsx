// tests/hooks/useTransferMembership.test.tsx — mutation de transferência
// empresarial atômica (M1-F S6-F, RPC de S6-D). transferMembershipRpc
// mockado. Cobertura central: p_successor_id é PROFILE_ID, nunca
// membership_id — contrato distinto de offboard_seller, verificado
// explicitamente aqui.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useTransferMembership,
  TRANSFER_MEMBERSHIP_LOCAL_ERRORS,
  getTransferMembershipErrorMessage,
} from '@/lib/hooks/useTransferMembership';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';

const mocks = vi.hoisted(() => ({ transferMembershipRpc: vi.fn() }));

vi.mock('@/lib/membershipLifecycle/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/membershipLifecycle/repository')>();
  return { ...actual, transferMembershipRpc: mocks.transferMembershipRpc };
});

const SOURCE_MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const TARGET_COMPANY_ID = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e';
const SUCCESSOR_PROFILE_ID = 'c3d4e5f6-a7b8-4c5d-9e0f-1a2b3c4d5e6f';

function buildResult(leadsReassigned: number) {
  return {
    profile_id: 'profile-1', source_membership_id: SOURCE_MEMBERSHIP_ID, destination_membership_id: 'membership-9',
    source_company_id: 'company-source', destination_company_id: TARGET_COMPANY_ID, destination_role: 'seller' as const,
    source_seller_id: 'seller-1', destination_seller_id: 'seller-9', leads_reassigned: leadsReassigned,
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
  mocks.transferMembershipRpc.mockReset();
  mocks.transferMembershipRpc.mockResolvedValue(buildResult(0));
});

describe('useTransferMembership — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: null, note: 'motivo válido',
    })).rejects.toThrow(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
    expect(mocks.transferMembershipRpc).not.toHaveBeenCalled();
  });

  it('targetCompanyId inválido: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: 'nao-e-uuid', targetRole: 'seller', successorProfileId: null, note: 'motivo válido',
    })).rejects.toThrow(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidCompany);
  });

  it('successorProfileId inválido (não-UUID): rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: 'nao-e-uuid', note: 'motivo válido',
    })).rejects.toThrow(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidSuccessor);
  });

  it('motivo vazio: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: null, note: '',
    })).rejects.toThrow(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.blankNote);
  });
});

describe('useTransferMembership — contrato do sucessor (PROFILE_ID, nunca membership_id)', () => {
  it('sucesso: chama transferMembershipRpc com os 5 args exatos, successorProfileId como profile_id', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'manager', successorProfileId: SUCCESSOR_PROFILE_ID, note: 'motivo válido',
    });
    expect(mocks.transferMembershipRpc).toHaveBeenCalledWith(
      SOURCE_MEMBERSHIP_ID, TARGET_COMPANY_ID, 'manager', SUCCESSOR_PROFILE_ID, 'motivo válido',
    );
  });

  it('erro de domínio (same_company_transfer_forbidden): propaga, nunca embrulha', async () => {
    mocks.transferMembershipRpc.mockRejectedValue(new Error('same_company_transfer_forbidden'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: null, note: 'motivo válido',
    })).rejects.toThrow('same_company_transfer_forbidden');
  });
});

describe('useTransferMembership — invalidação de cache', () => {
  it('sem reatribuição: invalida usuários, NUNCA leads', async () => {
    mocks.transferMembershipRpc.mockResolvedValue(buildResult(0));
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: null, note: 'motivo válido',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inactiveCompanyUserQueryKeys.root('user-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-source') });
  });

  it('com reatribuição (leads_reassigned>0): invalida leads da empresa de ORIGEM (source_company_id)', async () => {
    mocks.transferMembershipRpc.mockResolvedValue(buildResult(3));
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: SUCCESSOR_PROFILE_ID, note: 'motivo válido',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-source') });
  });
});

describe('useTransferMembership — isolamento por identidade', () => {
  it('identidade muda durante a chamada: resultado descartado', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.transferMembershipRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return buildResult(0);
    });
    const { result } = renderHook(() => useTransferMembership({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.transferMembership({
      sourceMembershipId: SOURCE_MEMBERSHIP_ID, targetCompanyId: TARGET_COMPANY_ID, targetRole: 'seller', successorProfileId: null, note: 'motivo válido',
    })).rejects.toThrow(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getTransferMembershipErrorMessage', () => {
  it('mapeia erros de domínio para mensagens estáveis', () => {
    expect(getTransferMembershipErrorMessage(new Error('same_company_transfer_forbidden'))).toMatch(/diferente/);
    expect(getTransferMembershipErrorMessage(new Error('successor_required'))).toMatch(/leads em aberto/);
    expect(getTransferMembershipErrorMessage(new Error('last_manager_requires_successor'))).toMatch(/outro Manager ativo/);
    expect(getTransferMembershipErrorMessage(new Error('active_membership_conflict'))).toMatch(/já possui um vínculo/);
    expect(getTransferMembershipErrorMessage(new Error('transfer_state_conflict'))).toMatch(/conflito de estado/);
    expect(getTransferMembershipErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getTransferMembershipErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível transferir este usuário. Tente novamente.');
  });
});
