// Testes de useCreateDeal (COMMERCIAL-REMOTE-DEALS-B2-B). Supabase
// mockado (rpc), sem rede real. Cobre: payload por actorRole, mode
// gating, identity gating, role mismatch, retry 0, invalidação de sucesso
// (Deals + timeline do Lead — incondicional, lead_id sempre NOT NULL), e
// a proteção de geração de cache em AMBOS os caminhos. Mesmo padrão de
// tests/hooks/useCreateVisit.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateDeal, type UseCreateDealOptions, type CreateDealCallInput } from '@/lib/hooks/useCreateDeal';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { isRemoteDealsError } from '@/lib/deals/errors';
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

const CREATED = {
  id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
  assigned_seller_id: 's1', vehicle: 'Golf GTI 2022', value_cents: 12000000, discount_percent: 3,
  payment_method: 'financiamento_100', down_payment_cents: null, installments: null, note: '',
  status: 'open', lost_by: null, lost_at: null, created_by: 'profile-1', updated_by: 'profile-1',
  created_at: '2026-08-21T10:00:00+00:00', updated_at: '2026-08-21T10:00:00+00:00', version: 1,
};

function baseOptions(overrides: Partial<UseCreateDealOptions> = {}): UseCreateDealOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCreateDealOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCreateDealOptions) => useCreateDeal(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const managerInput: CreateDealCallInput = {
  actorRole: 'manager',
  assignedSellerId: 's1',
  leadId: 'lead-1',
  vehicle: 'Golf GTI 2022',
  valueCents: 12000000,
  discountPercent: 3,
  paymentMethod: 'financiamento_100',
};

const sellerInput: CreateDealCallInput = {
  actorRole: 'seller',
  leadId: 'lead-1',
  vehicle: 'Golf GTI 2022',
  valueCents: 12000000,
  discountPercent: 3,
  paymentMethod: 'financiamento_100',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
  mocks.resolveDealRemoteMode.mockReset().mockReturnValue('deal_remote_ready');
});

describe('useCreateDeal — payload por actorRole', () => {
  it('Manager: envia assignedSellerId, nunca p_company_id/status/version', async () => {
    const { hook } = setup();
    await hook.result.current.createDeal(managerInput);
    expect(mocks.rpc).toHaveBeenCalledWith('create_deal', {
      p_lead_id: 'lead-1',
      p_vehicle: 'Golf GTI 2022',
      p_value_cents: 12000000,
      p_discount_percent: 3,
      p_payment_method: 'financiamento_100',
      p_down_payment_cents: null,
      p_installments: null,
      p_note: '',
      p_assigned_seller_id: 's1',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_version');
  });

  it('Seller: p_assigned_seller_id sempre null (tipo estruturalmente sem esse campo — backend autoatribui)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.createDeal(sellerInput);
    expect(mocks.rpc.mock.calls[0][1].p_assigned_seller_id).toBeNull();
  });
});

describe('useCreateDeal — mode gating', () => {
  it.each(['deal_local', 'deal_blocked', 'deal_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveDealRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.createDeal(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteDealsError(e));
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});

describe('useCreateDeal — identity gating', () => {
  it('sem companyId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.createDeal(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteDealsError(e));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.createDeal(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('usuário inativo: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.createDeal(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.createDeal(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateDeal — consistência de role (CRÍTICO)', () => {
  it('hook Manager + input actorRole seller: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createDeal(sellerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Seller + input actorRole manager: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createDeal(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Manager + input actorRole manager: permitido', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createDeal(managerInput)).resolves.toEqual(CREATED);
  });

  it('hook Seller + input actorRole seller: permitido', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createDeal(sellerInput)).resolves.toEqual(CREATED);
  });
});

describe('useCreateDeal — retry e invalidação de sucesso', () => {
  it('retry 0 — sem reenvio automático (create_deal não é idempotente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createDeal(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso: invalida Deals E a timeline do Lead (lead_id sempre presente em Deals)', async () => {
    const { hook, invalidateSpy } = setup();
    const created = await hook.result.current.createDeal(managerInput);
    expect(created).toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  it('erro do backend (seller_not_found) vira RemoteDealsError mapeado, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createDeal(managerInput)).rejects.toMatchObject({
      code: 'remote_deals_mutation_seller_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateDeal — proteção de geração de cache (AMBOS os caminhos)', () => {
  it('geração muda ENQUANTO a RPC ainda não resolveu, resposta RESOLVE com sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createDeal(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO: geração muda ENQUANTO a RPC ainda não resolveu, resposta REJEITA — identity_changed, NUNCA o código de erro da geração antiga, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createDeal(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_deals_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_deals_mutation_seller_not_found' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.createDeal(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).resolves.toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dealQueryKeys.active('company-a') });
  });
});
