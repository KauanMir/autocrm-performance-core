// Testes de useUpdateVisit (COMMERCIAL-REMOTE-VISITS-B2-B). Supabase
// mockado (rpc), sem rede real. Cobre: full-replace payload, mode/identity
// gating, expectedVersion obrigatório, stale_write preservado,
// invalidação em conflito (stale_write/visit_closed/visit_not_found),
// invalidação de sucesso (Visits + timeline condicional), proteção de
// geração. Mesmo padrão de tests/hooks/useUpdateTask.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateVisit, type UseUpdateVisitOptions, type UpdateVisitCallInput } from '@/lib/hooks/useUpdateVisit';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { companySellerLeaderboardQueryPrefix } from '@/lib/hooks/useCompanySellerLeaderboard';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveVisitRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/visits/remoteVisitsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/visits/remoteVisitsMode')>();
  return { ...actual, resolveVisitRemoteMode: mocks.resolveVisitRemoteMode };
});

const UPDATED_WITH_LEAD = {
  id: 'visit-1', company_id: 'company-a', lead_id: 'lead-1', client_name: null,
  assigned_seller_id: 's2', vehicles: ['Civic 2023'], scheduled_at: '2026-08-22T18:00:00+00:00',
  status: 'scheduled', outcome: null, note: 'atualizada', result_note: null, created_by: 'profile-1',
  updated_by: 'profile-1', closed_by: null, created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-21T10:00:00+00:00', closed_at: null, version: 2,
};

const UPDATED_NO_LEAD = { ...UPDATED_WITH_LEAD, lead_id: null, client_name: 'Cliente Avulso' };

function baseOptions(overrides: Partial<UseUpdateVisitOptions> = {}): UseUpdateVisitOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}

function setup(options: Partial<UseUpdateVisitOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseUpdateVisitOptions) => useUpdateVisit(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: UpdateVisitCallInput = {
  visitId: 'visit-1',
  expectedVersion: 1,
  scheduledAt: '2026-08-22T18:00:00+00:00',
  vehicles: ['Civic 2023'],
  note: 'atualizada',
  assignedSellerId: 's2',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED_WITH_LEAD, error: null });
  mocks.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_remote_ready');
});

describe('useUpdateVisit — payload full-replace', () => {
  it('envia os 6 argumentos exatos, nunca calcula status no client', async () => {
    const { hook } = setup();
    await hook.result.current.updateVisit(input);
    expect(mocks.rpc).toHaveBeenCalledWith('update_visit', {
      p_id: 'visit-1',
      p_expected_version: 1,
      p_scheduled_at: '2026-08-22T18:00:00+00:00',
      p_vehicles: ['Civic 2023'],
      p_note: 'atualizada',
      p_assigned_seller_id: 's2',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_status');
  });
});

describe('useUpdateVisit — mode/identity gating', () => {
  it.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveVisitRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.updateVisit(input)).rejects.toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('sem identidade completa: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.updateVisit(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion não-numérico: bloqueia com stale_write antes da RPC', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.updateVisit({ ...input, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_visits_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateVisit — invalidação em conflito', () => {
  it.each([
    ['stale_write', true],
    ['visit_closed', true],
    ['visit_not_found', true],
    ['seller_required', false],
    ['seller_not_found', false],
    ['invalid_vehicles', false],
    ['forbidden', false],
  ] as const)('erro %s → invalida=%s', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateVisit(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
  });
});

describe('useUpdateVisit — invalidação de sucesso', () => {
  it('com lead_id: invalida Visits + timeline do Lead + leaderboard (reassignment desloca scheduled_visit_count — COMPETITION-V2 §19)', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateVisit(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companySellerLeaderboardQueryPrefix('company-a') });
  });

  it('sem lead_id: invalida Visits + leaderboard', async () => {
    mocks.rpc.mockResolvedValue({ data: UPDATED_NO_LEAD, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateVisit(input);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companySellerLeaderboardQueryPrefix('company-a') });
  });

  it('§19 — update_visit NUNCA invalida sellerCompetitionEventsQueryKey (nenhuma celebração fabricada pelo frontend)', async () => {
    mocks.rpc.mockResolvedValue({ data: UPDATED_NO_LEAD, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateVisit(input);
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('competition-events'))).toBe(false);
  });
});

describe('useUpdateVisit — proteção de geração de cache', () => {
  it('geração muda antes da resposta (sucesso real): identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateVisit(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: UPDATED_WITH_LEAD, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração muda antes da resposta (stale_write real): identity_changed, nunca stale_write, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateVisit(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'stale_write' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_visits_mutation_stale_write' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
