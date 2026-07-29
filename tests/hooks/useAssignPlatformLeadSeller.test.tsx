// Testes de useAssignPlatformLeadSeller (M1-F S8-C2-D2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAssignPlatformLeadSeller,
  ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS,
  type AssignPlatformLeadSellerCallInput,
} from '@/lib/hooks/useAssignPlatformLeadSeller';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const ASSIGNED = { id: 'lead-1', company_id: 'company-a', seller_id: 'seller-1', version: 2 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useAssignPlatformLeadSeller({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<AssignPlatformLeadSellerCallInput> = {}): AssignPlatformLeadSellerCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    sellerId: 'seller-1',
    expectedVersion: 1,
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ASSIGNED, error: null });
});

describe('useAssignPlatformLeadSeller — validações locais', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.assignSeller(baseInput())).rejects.toThrow(ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.assignSeller(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useAssignPlatformLeadSeller — payload da RPC', () => {
  it('chama assign_lead_seller com o seller_id real', async () => {
    const { hook } = setup();
    await hook.result.current.assignSeller(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_seller_id: 'seller-1', p_expected_version: 1,
    });
  });

  it('sellerId null remove o vendedor — nunca profile_id/membership_id', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...ASSIGNED, seller_id: null }, error: null });
    const { hook } = setup();
    await hook.result.current.assignSeller(baseInput({ sellerId: null }));
    const sentArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(sentArgs.p_seller_id).toBeNull();
    expect(sentArgs).not.toHaveProperty('p_profile_id');
    expect(sentArgs).not.toHaveProperty('p_membership_id');
  });
});

describe('useAssignPlatformLeadSeller — sucesso e invalidação', () => {
  it('invalida SOMENTE leadsActive da empresa capturada', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.assignSeller(baseInput());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsArchived('company-a') });
  });
});

describe('useAssignPlatformLeadSeller — erro', () => {
  it('seller_not_found ⇒ PlatformCommercialError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.assignSeller(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('sem retry automático — assign_lead_seller exige expected_version sempre', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook } = setup();
    await expect(hook.result.current.assignSeller(baseInput())).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
