// Testes de useUpdateDeal (COMMERCIAL-REMOTE-DEALS-B2-B). Supabase
// mockado (rpc), sem rede real. Cobre: full-replace payload, mode/identity
// gating, expectedVersion obrigatório, stale_write preservado, invalidação
// em conflito (stale_write/deal_closed/deal_not_found), invalidação de
// sucesso (Deals + timeline incondicional), proteção de geração. Mesmo
// padrão de tests/hooks/useUpdateVisit.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateDeal, type UseUpdateDealOptions, type UpdateDealCallInput } from '@/lib/hooks/useUpdateDeal';
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

const UPDATED = {
  id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
  assigned_seller_id: 's2', vehicle: 'Civic 2023', value_cents: 13000000, discount_percent: 5,
  payment_method: 'a_vista', down_payment_cents: null, installments: null, note: 'atualizada',
  status: 'open', lost_by: null, lost_at: null, created_by: 'profile-1', updated_by: 'profile-1',
  created_at: '2026-08-20T10:00:00+00:00', updated_at: '2026-08-21T10:00:00+00:00', version: 2,
};

function baseOptions(overrides: Partial<UseUpdateDealOptions> = {}): UseUpdateDealOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}

function setup(options: Partial<UseUpdateDealOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseUpdateDealOptions) => useUpdateDeal(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: UpdateDealCallInput = {
  dealId: 'deal-1',
  expectedVersion: 1,
  vehicle: 'Civic 2023',
  valueCents: 13000000,
  discountPercent: 5,
  paymentMethod: 'a_vista',
  downPaymentCents: null,
  installments: null,
  note: 'atualizada',
  assignedSellerId: 's2',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
  mocks.resolveDealRemoteMode.mockReset().mockReturnValue('deal_remote_ready');
});

describe('useUpdateDeal — payload full-replace', () => {
  it('envia os 9 argumentos exatos, nunca calcula status/version no client', async () => {
    const { hook } = setup();
    await hook.result.current.updateDeal(input);
    expect(mocks.rpc).toHaveBeenCalledWith('update_deal', {
      p_id: 'deal-1',
      p_expected_version: 1,
      p_vehicle: 'Civic 2023',
      p_value_cents: 13000000,
      p_discount_percent: 5,
      p_payment_method: 'a_vista',
      p_down_payment_cents: null,
      p_installments: null,
      p_note: 'atualizada',
      p_assigned_seller_id: 's2',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_lead_id');
  });
});

describe('useUpdateDeal — mode/identity gating', () => {
  it.each(['deal_local', 'deal_blocked', 'deal_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveDealRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.updateDeal(input)).rejects.toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('sem identidade completa: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.updateDeal(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion não-numérico: bloqueia com stale_write antes da RPC', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.updateDeal({ ...input, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateDeal — invalidação em conflito', () => {
  it.each([
    ['stale_write', true],
    ['deal_closed', true],
    ['deal_not_found', true],
    ['seller_required', false],
    ['seller_not_found', false],
    ['invalid_vehicle', false],
    ['invalid_value', false],
    ['invalid_discount', false],
    ['lead_archived', false],
    ['forbidden', false],
  ] as const)('erro %s → invalida=%s', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateDeal(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
  });
});

describe('useUpdateDeal — invalidação de sucesso', () => {
  it('invalida Deals E a timeline do Lead (incondicional — lead_id sempre presente)', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateDeal(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  it('mesmo sem reatribuição de seller (assignedSellerId igual ao atual), ainda invalida timeline (refetch inofensivo)', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...UPDATED, assigned_seller_id: 's1' }, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateDeal({ ...input, assignedSellerId: 's1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });
});

describe('useUpdateDeal — proteção de geração de cache', () => {
  it('geração muda antes da resposta (sucesso real): identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateDeal(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: UPDATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração muda antes da resposta (stale_write real): identity_changed, nunca stale_write, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateDeal(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'stale_write' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_deals_mutation_stale_write' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
