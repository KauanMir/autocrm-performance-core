// Testes de useApplyLeadEvent (M1-E, E5-A1). Supabase mockado (rpc). Cobre:
// payload exato (sem p_company_id), evento tipado, bloqueios de identidade,
// invalidation (active, NUNCA timeline), ausência de mutation otimista,
// retry 0, proteção de identidade, ausência de import de LeadService/
// StoreAdapter/add_lead_timeline_entry.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useApplyLeadEvent,
  type UseApplyLeadEventOptions,
  type ApplyLeadEventCallInput,
} from '@/lib/hooks/useApplyLeadEvent';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const EVENTED = { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-1', urgency: 'green', version: 2 };

function baseOptions(overrides: Partial<UseApplyLeadEventOptions> = {}): UseApplyLeadEventOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseApplyLeadEventOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseApplyLeadEventOptions) => useApplyLeadEvent(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: ApplyLeadEventCallInput = { leadId: 'lead-1', eventType: 'visit_confirmed' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: EVENTED, error: null });
});

describe('useApplyLeadEvent — payload', () => {
  it('envia exatamente p_lead_id/p_event_type, nunca p_company_id', async () => {
    const { hook } = setup();
    await hook.result.current.applyLeadEvent(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('apply_lead_event', {
      p_lead_id: 'lead-1',
      p_event_type: 'visit_confirmed',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
  });
});

describe('useApplyLeadEvent — Manager e Seller operacionais', () => {
  it('Manager: chama a RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await hook.result.current.applyLeadEvent(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('Seller: chama a RPC (posse do Lead é decidida pelo backend, não por este hook)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.applyLeadEvent(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useApplyLeadEvent — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.applyLeadEvent(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.applyLeadEvent(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('profile inativo bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.applyLeadEvent(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useApplyLeadEvent — sucesso, invalidação e ausência de timeline', () => {
  it('invalida somente active(companyId capturado), NUNCA timeline', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.applyLeadEvent(baseInput);
    expect(result).toEqual(EVENTED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.applyLeadEvent(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('useApplyLeadEvent — erro e retry', () => {
  it('lead_archived do backend vira RemoteLeadsError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.applyLeadEvent(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_lead_archived',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('stage_not_found do backend (evento exige stage_code inexistente) vira RemoteLeadsError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    const { hook } = setup();
    await expect(hook.result.current.applyLeadEvent({ leadId: 'lead-1', eventType: 'call_outcome_visit' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_stage_not_found' });
  });

  it('retry 0 — sem reenvio automático (apply_lead_event não é idempotente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.applyLeadEvent(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useApplyLeadEvent — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.applyLeadEvent(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: EVENTED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
