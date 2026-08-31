// Testes de useRegisterSale (COMMERCIAL-REMOTE-SALES-A2). Supabase mockado
// (rpc), sem rede real. Cobre: input mínimo (deal/version/valor/pagamento,
// nunca company/lead/seller/soldBy), mode/identity gating, invalidação em
// conflito (só Deals — nenhuma Sale foi criada), invalidação de sucesso
// (Deals + Sales + timeline), proteção de geração, retorno = Deal
// atualizada. Mesmo padrão de tests/hooks/useMarkDealLost.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegisterSale, type UseRegisterSaleOptions, type RegisterSaleCallInput } from '@/lib/hooks/useRegisterSale';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { companySellerLeaderboardQueryPrefix } from '@/lib/hooks/useCompanySellerLeaderboard';
import { sellerCompetitionEventsQueryKey } from '@/lib/hooks/useSellerCompetitionEvents';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveSalesRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/sales/remoteSalesMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sales/remoteSalesMode')>();
  return { ...actual, resolveSalesRemoteMode: mocks.resolveSalesRemoteMode };
});

const SOLD_DEAL = {
  id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
  assigned_seller_id: 's1', vehicle: 'Golf GTI 2022', value_cents: 12000000, discount_percent: 0,
  payment_method: 'a_vista', down_payment_cents: null, installments: null, note: '',
  status: 'sold', lost_by: null, lost_at: null, created_by: 'profile-1',
  updated_by: 'profile-1', created_at: '2026-08-20T10:00:00+00:00', updated_at: '2026-08-22T10:00:00+00:00', version: 2,
};

function baseOptions(overrides: Partial<UseRegisterSaleOptions> = {}): UseRegisterSaleOptions {
  return { userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true, ...overrides };
}

function setup(options: Partial<UseRegisterSaleOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseRegisterSaleOptions) => useRegisterSale(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const input: RegisterSaleCallInput = {
  dealId: 'deal-1', expectedVersion: 1, soldValueCents: 11500000, paymentMethod: 'a_vista',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: SOLD_DEAL, error: null });
  mocks.resolveSalesRemoteMode.mockReset().mockReturnValue('sale_remote_ready');
});

describe('useRegisterSale — input mínimo', () => {
  it('envia somente deal_id/expected_version/sold_value_cents/payment_method', async () => {
    const { hook } = setup();
    await hook.result.current.registerSale(input);
    expect(mocks.rpc).toHaveBeenCalledWith('register_sale', {
      p_deal_id: 'deal-1',
      p_expected_version: 1,
      p_sold_value_cents: 11500000,
      p_payment_method: 'a_vista',
    });
  });

  it('CallInput não possui company/lead/seller/soldBy em runtime (Object.keys)', () => {
    expect(Object.keys(input).sort()).toEqual(['dealId', 'expectedVersion', 'paymentMethod', 'soldValueCents']);
  });
});

describe('useRegisterSale — mode/identity gating', () => {
  it.each(['sale_local', 'sale_blocked', 'sale_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveSalesRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.registerSale(input)).rejects.toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('sem identidade completa: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.registerSale(input)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion não-numérico: bloqueia com stale_write antes da RPC', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.registerSale({ ...input, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_sales_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useRegisterSale — invalidação em conflito (só Deals — nenhuma Sale foi criada)', () => {
  it.each([
    ['stale_write', true],
    ['deal_closed', true],
    ['deal_not_found', true],
    ['forbidden', false],
  ] as const)('erro %s → invalida Deals=%s, nunca Sales', async (backendMessage, shouldInvalidate) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.registerSale(input)).rejects.toBeTruthy();
    if (shouldInvalidate) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    } else {
      expect(invalidateSpy).not.toHaveBeenCalled();
    }
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: salesQueryKeys.active('company-a') });
  });
});

describe('useRegisterSale — invalidação de sucesso', () => {
  it('invalida Deals E Sales E a timeline do Lead', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.registerSale(input);
    expect(result.status).toBe('sold');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: salesQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  // PODIUM-COMPETITION-R2B §33/§34 — Pódio/Ranking/Minha Disputa/CompTicker
  // (leaderboard) + eventos de comemoração pessoal continuam invalidados.
  it('preserva as invalidações de competição (leaderboard + eventos do Seller)', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.registerSale(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companySellerLeaderboardQueryPrefix('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sellerCompetitionEventsQueryKey('company-a', 'user-1') });
  });

  // COMPETITION-REWARDS-V1-B3-R1-EXEC §1/§8 — repro do achado do public
  // smoke: Seller em 2º (my_reward=R$0,50) registra venda que o leva a 1º;
  // sem esta invalidação o "Prêmio da sua posição" na Home ficava obsoleto
  // até um reload. Invalida o PREFIXO do overview (pega a chave por-usuário).
  it('invalida também o overview de premiação da competição (my_rank/my_reward)', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.registerSale(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: competitionRewardQueryKeys.overviewPrefix('company-a') });
  });

  // §5 — nada de over-invalidation: o editor de campanha do Manager e o
  // histórico de premiações NÃO são tocados por uma venda.
  it('NÃO invalida o editor de campanha nem o histórico de premiações', async () => {
    const { hook, invalidateSpy } = setup();
    await hook.result.current.registerSale(input);
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys.some((k) => k?.includes('competition-reward-campaign'))).toBe(false);
    expect(invalidatedKeys.some((k) => k?.includes('competition-reward-history'))).toBe(false);
  });
});

describe('useRegisterSale — retorno é a Deal atualizada', () => {
  it('resultado de sucesso reflete status sold e a version retornada pelo servidor', async () => {
    const { hook } = setup();
    const result = await hook.result.current.registerSale(input);
    expect(result.status).toBe('sold');
    expect(result.version).toBe(2);
  });
});

describe('useRegisterSale — proteção de geração de cache', () => {
  it('geração muda antes da resposta (sucesso real): identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.registerSale(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: SOLD_DEAL, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_sales_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração muda antes da resposta (deal_closed real): identity_changed, nunca deal_closed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.registerSale(input);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'deal_closed' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_sales_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_sales_mutation_deal_closed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
