// Testes de useUnarchivePlatformLead (M1-F S8-C2-D2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUnarchivePlatformLead,
  UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS,
  type UnarchivePlatformLeadCallInput,
} from '@/lib/hooks/useUnarchivePlatformLead';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const UNARCHIVED = { id: 'lead-1', company_id: 'company-a', archived_at: null, version: 3 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUnarchivePlatformLead({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<UnarchivePlatformLeadCallInput> = {}): UnarchivePlatformLeadCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    expectedVersion: 2,
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UNARCHIVED, error: null });
});

describe('useUnarchivePlatformLead — validações locais', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.unarchiveLead(baseInput())).rejects.toThrow(UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.unarchiveLead(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUnarchivePlatformLead — payload e invalidação', () => {
  it('chama unarchive_lead com os campos corretos', async () => {
    const { hook } = setup();
    await hook.result.current.unarchiveLead(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('unarchive_lead', {
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_expected_version: 2,
    });
  });

  it('sucesso invalida active, archived E timeline (E7-B2-C) da empresa capturada', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.unarchiveLead(baseInput());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsArchived('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1') });
  });

  it('NUNCA invalida leadQueryKeys (família operacional Manager/Seller) — isolamento entre superfícies', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.unarchiveLead(baseInput());
    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey?: unknown[] })?.queryKey;
      expect(key?.includes('platform')).toBe(true);
    }
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });
});

describe('useUnarchivePlatformLead — erro', () => {
  it('erro ⇒ PlatformCommercialError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.unarchiveLead(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
