// Testes de useUpdatePlatformLead (M1-F S8-C2-C2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdatePlatformLead,
  UPDATE_PLATFORM_LEAD_LOCAL_ERRORS,
  type UpdatePlatformLeadCallInput,
} from '@/lib/hooks/useUpdatePlatformLead';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const UPDATED = { id: 'lead-1', company_id: 'company-a', name: 'Cliente Editado', version: 2 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdatePlatformLead({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<UpdatePlatformLeadCallInput> = {}): UpdatePlatformLeadCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    expectedVersion: 1,
    name: 'Cliente Editado',
    phone: '11999990000',
    car: 'Golf',
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
});

describe('useUpdatePlatformLead — validações locais bloqueiam antes da RPC', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.updateLead(baseInput())).rejects.toThrow(UPDATE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.updateLead(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(UPDATE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdatePlatformLead — payload da RPC', () => {
  it('chama update_lead só com os campos reais — nunca seller_id/stage/archived_at', async () => {
    const { hook } = setup();
    await hook.result.current.updateLead(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('update_lead', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
      p_expected_version: 1,
      p_name: 'Cliente Editado',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_payment_preference: undefined,
      p_source: undefined,
      p_temperature: undefined,
    });
    const sentArgs = mocks.rpc.mock.calls[0][1];
    expect(sentArgs).not.toHaveProperty('p_seller_id');
    expect(sentArgs).not.toHaveProperty('p_stage_id');
    expect(sentArgs).not.toHaveProperty('p_archived_at');
  });
});

describe('useUpdatePlatformLead — sucesso e invalidação', () => {
  it('invalida SOMENTE leadsActive da empresa capturada — update_lead nunca afeta arquivados', async () => {
    const { hook, invalidateSpy } = setup();
    const updated = await hook.result.current.updateLead(baseInput());
    expect(updated).toEqual(UPDATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsArchived('company-a') });
  });
});

describe('useUpdatePlatformLead — erro', () => {
  it('erro stale_write vira PlatformCommercialError, nenhuma invalidação ocorre', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateLead(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('sem retry automático — update_lead usa optimistic locking (version)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook } = setup();
    await expect(hook.result.current.updateLead(baseInput())).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
