// Testes de useAddLeadTimelineEntry (M1-E, E7-B2-A1). Supabase mockado
// (rpc). Cobre: payload fixo (icon/color/label), ausência de p_company_id/
// actor, bloqueios de identidade, invalidação SOMENTE da timeline
// (nunca active/archived/detail), proteção de identidade (geração de
// cache), retry 0, sem mutation otimista.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAddLeadTimelineEntry,
  type UseAddLeadTimelineEntryOptions,
  type AddLeadTimelineEntryCallInput,
} from '@/lib/hooks/useAddLeadTimelineEntry';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { MANUAL_TIMELINE_ICON, MANUAL_TIMELINE_COLOR, MANUAL_TIMELINE_LABEL } from '@/lib/leads/timelineRepository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED = {
  id: 'tl-1', company_id: 'company-a', lead_id: 'lead-1', actor_profile_id: 'user-1',
  icon: MANUAL_TIMELINE_ICON, color: MANUAL_TIMELINE_COLOR, label: MANUAL_TIMELINE_LABEL,
  detail: 'Cliente confirmou retorno', occurred_at: '2026-07-31T10:00:00Z', created_at: '2026-07-31T10:00:00Z',
};

function baseOptions(overrides: Partial<UseAddLeadTimelineEntryOptions> = {}): UseAddLeadTimelineEntryOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseAddLeadTimelineEntryOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseAddLeadTimelineEntryOptions) => useAddLeadTimelineEntry(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: AddLeadTimelineEntryCallInput = { leadId: 'lead-1', detail: 'Cliente confirmou retorno' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
});

describe('useAddLeadTimelineEntry — payload', () => {
  it('envia icon/color/label FIXOS e detail — nunca p_company_id/actor/e-mail', async () => {
    const { hook } = setup();
    await hook.result.current.addTimelineEntry(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('add_lead_timeline_entry', {
      p_lead_id: 'lead-1',
      p_icon: MANUAL_TIMELINE_ICON,
      p_label: MANUAL_TIMELINE_LABEL,
      p_color: MANUAL_TIMELINE_COLOR,
      p_detail: 'Cliente confirmou retorno',
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_actor_profile_id');
  });
});

describe('useAddLeadTimelineEntry — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.addTimelineEntry(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.addTimelineEntry(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('userIsActive false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.addTimelineEntry(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useAddLeadTimelineEntry — sucesso, invalidação e ausência de otimismo', () => {
  it('invalida SOMENTE leadQueryKeys.timeline(companyId, leadId) — nunca active/archived/detail', async () => {
    const { hook, invalidateSpy } = setup();
    const record = await hook.result.current.addTimelineEntry(baseInput);
    expect(record).toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.archived('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail('company-a', 'lead-1') });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.addTimelineEntry(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('useAddLeadTimelineEntry — erro e retry', () => {
  it('erro do Supabase vira RemoteLeadsError sanitizado, nenhuma invalidação, texto não é limpo pelo hook', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'lead_archived' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.addTimelineEntry(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_lead_archived',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('retry 0 — sem reenvio automático', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.addTimelineEntry(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useAddLeadTimelineEntry — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.addTimelineEntry(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
