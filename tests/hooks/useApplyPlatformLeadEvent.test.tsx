// Testes de useApplyPlatformLeadEvent (M1-F S8-C2-D2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useApplyPlatformLeadEvent,
  APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS,
  type ApplyPlatformLeadEventCallInput,
} from '@/lib/hooks/useApplyPlatformLeadEvent';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const UPDATED = { id: 'lead-1', company_id: 'company-a', urgency: 'green', version: 2 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useApplyPlatformLeadEvent({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<ApplyPlatformLeadEventCallInput> = {}): ApplyPlatformLeadEventCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    eventType: 'visit_confirmed',
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
});

describe('useApplyPlatformLeadEvent — validações locais', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.applyEvent(baseInput())).rejects.toThrow(APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.applyEvent(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useApplyPlatformLeadEvent — payload e eventos reais', () => {
  it('chama apply_lead_event com o eventType exato, nenhum payload adicional', async () => {
    const { hook } = setup();
    await hook.result.current.applyEvent(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('apply_lead_event', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
      p_event_type: 'visit_confirmed',
    });
  });

  it.each([
    'call_outcome_visit', 'call_outcome_proposal', 'call_outcome_callback', 'call_outcome_no_answer',
    'visit_scheduled_complete', 'visit_scheduled_incomplete', 'visit_confirmed', 'visit_canceled',
    'visit_rescheduled', 'deal_created_needs_approval', 'deal_created_direct', 'deal_approved',
    'deal_rejected', 'sale_registered', 'sale_canceled', 'visit_result_done', 'visit_result_thinking',
    'visit_result_no_interest',
  ] as const)('evento real %s é repassado sem alteração', async (eventType) => {
    const { hook } = setup();
    await hook.result.current.applyEvent(baseInput({ eventType }));
    expect(mocks.rpc).toHaveBeenCalledWith('apply_lead_event', expect.objectContaining({ p_event_type: eventType }));
  });
});

describe('useApplyPlatformLeadEvent — sucesso e invalidação', () => {
  it('invalida SOMENTE leadsActive — apply_lead_event nunca grava timeline', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.applyEvent(baseInput());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1') });
  });
});

describe('useApplyPlatformLeadEvent — erro', () => {
  it('erro ⇒ PlatformCommercialError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.applyEvent(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
