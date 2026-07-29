// Testes de useAddPlatformLeadTimelineEntry (M1-F S8-C2-D2). Supabase
// mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAddPlatformLeadTimelineEntry,
  ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS,
  type AddPlatformLeadTimelineEntryCallInput,
} from '@/lib/hooks/useAddPlatformLeadTimelineEntry';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const ENTRY = { id: 'entry-1', company_id: 'company-a', lead_id: 'lead-1', label: 'Nota', icon: 'message', color: '#3B82F6' };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useAddPlatformLeadTimelineEntry({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<AddPlatformLeadTimelineEntryCallInput> = {}): AddPlatformLeadTimelineEntryCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    icon: 'message',
    color: '#3B82F6',
    label: 'Contato realizado',
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ENTRY, error: null });
});

describe('useAddPlatformLeadTimelineEntry — validações locais', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.addTimelineEntry(baseInput())).rejects.toThrow(ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.addTimelineEntry(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useAddPlatformLeadTimelineEntry — payload e invalidação', () => {
  it('chama add_lead_timeline_entry com os campos reais', async () => {
    const { hook } = setup();
    await hook.result.current.addTimelineEntry(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('add_lead_timeline_entry', {
      p_company_id: 'company-a', p_lead_id: 'lead-1', p_icon: 'message', p_color: '#3B82F6',
      p_label: 'Contato realizado', p_detail: undefined,
    });
  });

  it('sucesso invalida SOMENTE a timeline do Lead+empresa capturados — nunca leadsActive/leadsArchived', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.addTimelineEntry(baseInput());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsArchived('company-a') });
  });

  it('nunca invalida a timeline de outro Lead/empresa', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.addTimelineEntry(baseInput());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-b', 'lead-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-a', 'lead-2') });
  });
});

describe('useAddPlatformLeadTimelineEntry — erro', () => {
  it('erro ⇒ PlatformCommercialError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.addTimelineEntry(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
