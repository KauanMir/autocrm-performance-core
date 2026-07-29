// Testes de useMovePlatformLead (M1-F S8-C2-D2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMovePlatformLead,
  MOVE_PLATFORM_LEAD_LOCAL_ERRORS,
  type MovePlatformLeadCallInput,
} from '@/lib/hooks/useMovePlatformLead';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const MOVED = { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-2', version: 2 };

function setup(options: { authorized?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMovePlatformLead({ authorized: true, ...options }), { wrapper });
  return { queryClient, invalidateSpy, hook };
}

function baseInput(overrides: Partial<MovePlatformLeadCallInput> = {}): MovePlatformLeadCallInput {
  return {
    companyId: 'company-a',
    leadId: 'lead-1',
    stageId: 'stage-2',
    isContextStillValid: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: MOVED, error: null });
});

describe('useMovePlatformLead — validações locais bloqueiam antes da RPC', () => {
  it('authorized=false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.moveLead(baseInput())).rejects.toThrow(MOVE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isContextStillValid()===false bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(hook.result.current.moveLead(baseInput({ isContextStillValid: () => false })))
      .rejects.toThrow(MOVE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useMovePlatformLead — payload da RPC', () => {
  it('chama move_lead_to_stage com os campos corretos', async () => {
    const { hook } = setup();
    await hook.result.current.moveLead(baseInput());
    expect(mocks.rpc).toHaveBeenCalledWith('move_lead_to_stage', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
      p_stage_id: 'stage-2',
      p_expected_version: undefined,
    });
  });

  it('expectedVersion informada é enviada (optimistic locking quando disponível)', async () => {
    const { hook } = setup();
    await hook.result.current.moveLead(baseInput({ expectedVersion: 1 }));
    expect(mocks.rpc).toHaveBeenCalledWith('move_lead_to_stage', expect.objectContaining({ p_expected_version: 1 }));
  });
});

describe('useMovePlatformLead — sucesso e invalidação', () => {
  it('invalida SOMENTE leadsActive da empresa capturada', async () => {
    const { hook, invalidateSpy } = setup();
    const moved = await hook.result.current.moveLead(baseInput());
    expect(moved).toEqual(MOVED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsActive('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsArchived('company-a') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1') });
  });
});

describe('useMovePlatformLead — erro', () => {
  it('erro stage_not_found vira PlatformCommercialError, nenhuma invalidação ocorre', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.moveLead(baseInput())).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('sem retry automático', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook } = setup();
    await expect(hook.result.current.moveLead(baseInput())).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
