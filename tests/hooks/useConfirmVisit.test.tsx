// Testes de useConfirmVisit (COMMERCIAL-REMOTE-VISITS-B2-B). Supabase
// mockado (rpc), sem rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConfirmVisit, type UseConfirmVisitOptions } from '@/lib/hooks/useConfirmVisit';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolveVisitRemoteMode: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));
vi.mock('@/lib/visits/remoteVisitsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/visits/remoteVisitsMode')>();
  return { ...actual, resolveVisitRemoteMode: mocks.resolveVisitRemoteMode };
});

const CONFIRMED_WITH_LEAD = {
  id: 'visit-1', company_id: 'company-a', lead_id: 'lead-1', client_name: null,
  assigned_seller_id: 's1', vehicles: ['Golf'], scheduled_at: '2026-08-21T17:00:00+00:00',
  status: 'confirmed', outcome: null, note: '', result_note: null, created_by: 'profile-1',
  updated_by: 'profile-1', closed_by: null, created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-21T10:00:00+00:00', closed_at: null, version: 2,
};
const CONFIRMED_NO_LEAD = { ...CONFIRMED_WITH_LEAD, lead_id: null, client_name: 'Avulso' };

function baseOptions(overrides: Partial<UseConfirmVisitOptions> = {}): UseConfirmVisitOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}
function setup(options: Partial<UseConfirmVisitOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseConfirmVisitOptions) => useConfirmVisit(opts), { wrapper, initialProps: baseOptions(options) });
  return { queryClient, invalidateSpy, hook };
}

const input = { visitId: 'visit-1', expectedVersion: 1 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CONFIRMED_WITH_LEAD, error: null });
  mocks.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_remote_ready');
});

describe('useConfirmVisit — chamada e gates', () => {
  it('chama confirm_visit com p_id/p_expected_version', async () => {
    const { hook } = setup();
    await hook.result.current.confirmVisit(input);
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_visit', { p_id: 'visit-1', p_expected_version: 1 });
  });

  it.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)('mode=%s bloqueia', async (mode) => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    const { hook } = setup();
    await expect(hook.result.current.confirmVisit(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem identidade: bloqueia', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.confirmVisit(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useConfirmVisit — invalidação em conflito', () => {
  it.each([
    ['stale_write', true],
    ['visit_closed', true],
    ['visit_not_found', true],
    ['invalid_status_transition', true],
    ['forbidden', false],
  ] as const)('erro %s → invalida=%s', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.confirmVisit(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
  });
});

describe('useConfirmVisit — invalidação de sucesso e geração', () => {
  it('com lead_id: invalida Visits + timeline', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.confirmVisit(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  it('sem lead_id: invalida só Visits', async () => {
    mocks.rpc.mockResolvedValue({ data: CONFIRMED_NO_LEAD, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.confirmVisit(input);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('geração muda antes da resposta: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();
    const promise = hook.result.current.confirmVisit(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CONFIRMED_WITH_LEAD, error: null });
    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
