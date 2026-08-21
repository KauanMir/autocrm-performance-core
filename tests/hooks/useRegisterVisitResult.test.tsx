// Testes de useRegisterVisitResult (COMMERCIAL-REMOTE-VISITS-B2-B).
// Supabase mockado (rpc), sem rede real. Confirma explicitamente que
// nenhuma Sale/Deal/Task é iniciada por este hook (isso pertence à UI
// futura, nunca a esta camada).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegisterVisitResult, type UseRegisterVisitResultOptions } from '@/lib/hooks/useRegisterVisitResult';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolveVisitRemoteMode: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: mocks.rpc }, isSupabaseConfigured: true }));
vi.mock('@/lib/visits/remoteVisitsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/visits/remoteVisitsMode')>();
  return { ...actual, resolveVisitRemoteMode: mocks.resolveVisitRemoteMode };
});

function resultRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'visit-1', company_id: 'company-a', lead_id: 'lead-1', client_name: null,
    assigned_seller_id: 's1', vehicles: ['Golf'], scheduled_at: '2026-08-21T17:00:00+00:00',
    status: 'completed', outcome: 'sold', note: '', result_note: 'Fechou na hora', created_by: 'profile-1',
    updated_by: 'profile-1', closed_by: 'profile-1', created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-21T10:00:00+00:00', closed_at: '2026-08-21T10:00:00+00:00', version: 2,
    ...overrides,
  };
}

function baseOptions(overrides: Partial<UseRegisterVisitResultOptions> = {}): UseRegisterVisitResultOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}
function setup(options: Partial<UseRegisterVisitResultOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseRegisterVisitResultOptions) => useRegisterVisitResult(opts), { wrapper, initialProps: baseOptions(options) });
  return { queryClient, invalidateSpy, hook };
}

const input = { visitId: 'visit-1', expectedVersion: 1, outcome: 'sold' as const, resultNote: 'Fechou na hora' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: resultRow(), error: null });
  mocks.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_remote_ready');
});

describe('useRegisterVisitResult — chamada e gates', () => {
  it('chama register_visit_result com os 4 argumentos exatos', async () => {
    const { hook } = setup();
    await hook.result.current.registerVisitResult(input);
    expect(mocks.rpc).toHaveBeenCalledWith('register_visit_result', {
      p_id: 'visit-1',
      p_expected_version: 1,
      p_outcome: 'sold',
      p_result_note: 'Fechou na hora',
    });
  });

  it.each(['sold', 'negotiating', 'thinking', 'no_interest'] as const)('outcome=%s aceito pelo TypeScript contract', async (outcome) => {
    mocks.rpc.mockResolvedValue({ data: resultRow({ outcome }), error: null });
    const { hook } = setup();
    const result = await hook.result.current.registerVisitResult({ ...input, outcome });
    expect(result.outcome).toBe(outcome);
  });

  it.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)('mode=%s bloqueia', async (mode) => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    const { hook } = setup();
    await expect(hook.result.current.registerVisitResult(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useRegisterVisitResult — não inicia Sale/Deal/Task', () => {
  it('resultado da mutation contém somente a RemoteVisitRow — nenhuma chamada adicional de RPC além de register_visit_result', async () => {
    const { hook } = setup();
    await hook.result.current.registerVisitResult(input);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('register_visit_result', expect.anything());
  });
});

describe('useRegisterVisitResult — invalidação em conflito', () => {
  it.each([
    ['stale_write', true],
    ['visit_closed', true],
    ['visit_not_found', true],
    ['forbidden', false],
  ] as const)('erro %s → invalida=%s', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.registerVisitResult(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
  });
});

describe('useRegisterVisitResult — invalidação de sucesso e geração', () => {
  it('com lead_id: invalida Visits + timeline', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.registerVisitResult(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  it('sem lead_id: invalida só Visits', async () => {
    mocks.rpc.mockResolvedValue({ data: resultRow({ lead_id: null, client_name: 'Avulso' }), error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.registerVisitResult(input);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('geração muda antes da resposta: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();
    const promise = hook.result.current.registerVisitResult(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: resultRow(), error: null });
    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
