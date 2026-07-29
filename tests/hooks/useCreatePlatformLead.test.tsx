// Testes de useCreatePlatformLead (M1-F S8-C2-C2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreatePlatformLead,
  CREATE_PLATFORM_LEAD_LOCAL_ERRORS,
  type CreatePlatformLeadCallInput,
} from '@/lib/hooks/useCreatePlatformLead';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED = { id: 'lead-1', company_id: 'company-a', name: 'Cliente', version: 1 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreatePlatformLead({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<CreatePlatformLeadCallInput> = {}): CreatePlatformLeadCallInput {
  return {
    companyId: 'company-a',
    name: 'Cliente',
    phone: '11999990000',
    car: 'Golf',
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
});

describe('useCreatePlatformLead — validações locais bloqueiam antes da RPC', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.createLead(baseInput())).rejects.toThrow(CREATE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase (troca de empresa em voo)', async () => {
    const { hook } = setup();
    await expect(hook.result.current.createLead(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(CREATE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreatePlatformLead — payload da RPC', () => {
  it('chama create_lead com p_company_id explícito e os campos corretos', async () => {
    const { hook } = setup();
    await hook.result.current.createLead(baseInput({ sellerId: 's1', temperature: 'hot', paymentPreference: 'À vista', source: 'WhatsApp' }));
    expect(mocks.rpc).toHaveBeenCalledWith('create_lead', {
      p_company_id: 'company-a',
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_payment_preference: 'À vista',
      p_seller_id: 's1',
      p_source: 'WhatsApp',
      p_temperature: 'hot',
    });
  });

  it('sem vendedor (sellerId ausente): p_seller_id undefined, nunca profile_id', async () => {
    const { hook } = setup();
    await hook.result.current.createLead(baseInput());
    expect(mocks.rpc.mock.calls[0][1].p_seller_id).toBeUndefined();
  });
});

describe('useCreatePlatformLead — sucesso e invalidação', () => {
  it('invalida SOMENTE leadsActive da empresa capturada (input.companyId)', async () => {
    const { hook, invalidateSpy } = setup();
    const created = await hook.result.current.createLead(baseInput());
    expect(created).toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-b') });
  });

  it('empresa diferente nunca é invalidada por engano', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.createLead(baseInput({ companyId: 'company-b' }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-b') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
  });
});

describe('useCreatePlatformLead — erro', () => {
  it('erro do Supabase vira PlatformCommercialError, nenhuma invalidação ocorre', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createLead(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('sem retry automático — create_lead não é idempotente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook } = setup();
    await expect(hook.result.current.createLead(baseInput())).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
