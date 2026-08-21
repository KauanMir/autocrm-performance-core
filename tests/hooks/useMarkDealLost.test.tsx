// Testes de useMarkDealLost (COMMERCIAL-REMOTE-DEALS-B2-B). Supabase
// mockado (rpc), sem rede real. Cobre: input mínimo (id/version), mode/
// identity gating, invalidação em conflito (stale_write/deal_closed/
// deal_not_found), invalidação de sucesso (Deals + timeline), proteção de
// geração, ausência de reason/sold. Mesmo padrão de
// tests/hooks/useCancelVisit.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMarkDealLost, type UseMarkDealLostOptions, type MarkDealLostCallInput } from '@/lib/hooks/useMarkDealLost';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveDealRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/deals/remoteDealsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/deals/remoteDealsMode')>();
  return { ...actual, resolveDealRemoteMode: mocks.resolveDealRemoteMode };
});

const LOST = {
  id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
  assigned_seller_id: 's1', vehicle: 'Golf GTI 2022', value_cents: 12000000, discount_percent: 3,
  payment_method: 'financiamento_100', down_payment_cents: null, installments: null, note: '',
  status: 'lost', lost_by: 'profile-1', lost_at: '2026-08-21T12:00:00+00:00', created_by: 'profile-1',
  updated_by: 'profile-1', created_at: '2026-08-20T10:00:00+00:00', updated_at: '2026-08-21T12:00:00+00:00', version: 2,
};

function baseOptions(overrides: Partial<UseMarkDealLostOptions> = {}): UseMarkDealLostOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}

function setup(options: Partial<UseMarkDealLostOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseMarkDealLostOptions) => useMarkDealLost(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: MarkDealLostCallInput = { dealId: 'deal-1', expectedVersion: 1 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: LOST, error: null });
  mocks.resolveDealRemoteMode.mockReset().mockReturnValue('deal_remote_ready');
});

describe('useMarkDealLost — input mínimo', () => {
  it('envia somente id/expected_version — sem reason, sem note', async () => {
    const { hook } = setup();
    await hook.result.current.markDealLost(input);
    expect(mocks.rpc).toHaveBeenCalledWith('mark_deal_lost', {
      p_id: 'deal-1',
      p_expected_version: 1,
    });
  });

  it('CallInput não possui campo de motivo em runtime (Object.keys)', () => {
    expect(Object.keys(input).sort()).toEqual(['dealId', 'expectedVersion']);
  });
});

describe('useMarkDealLost — mode/identity gating', () => {
  it.each(['deal_local', 'deal_blocked', 'deal_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveDealRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.markDealLost(input)).rejects.toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('sem identidade completa: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.markDealLost(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion não-numérico: bloqueia com stale_write antes da RPC', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.markDealLost({ ...input, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useMarkDealLost — invalidação em conflito', () => {
  it.each([
    ['stale_write', true],
    ['deal_closed', true],
    ['deal_not_found', true],
    ['forbidden', false],
  ] as const)('erro %s → invalida=%s', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.markDealLost(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
  });
});

describe('useMarkDealLost — invalidação de sucesso', () => {
  it('invalida Deals E a timeline do Lead', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.markDealLost(input);
    expect(result.status).toBe('lost');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });
});

describe('useMarkDealLost — nenhum caminho para sold', () => {
  it('resultado de sucesso nunca é status sold (mark_deal_lost só produz lost)', async () => {
    const { hook } = setup();
    const result = await hook.result.current.markDealLost(input);
    expect(result.status).not.toBe('sold');
  });
});

describe('useMarkDealLost — proteção de geração de cache', () => {
  it('geração muda antes da resposta (sucesso real): identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.markDealLost(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: LOST, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração muda antes da resposta (deal_closed real): identity_changed, nunca deal_closed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.markDealLost(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'deal_closed' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_deals_mutation_deal_closed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
