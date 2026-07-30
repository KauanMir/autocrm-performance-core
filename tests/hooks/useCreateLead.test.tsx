// Testes de useCreateLead (M1-E, E4-B1). Supabase mockado (rpc), sem rede
// real. Cobre: payload por actorRole, ausência de p_company_id, Seller
// nunca envia sellerId, bloqueios de identidade, invalidation, proteção de
// geração de cache (identity_changed), retry 0.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateLead, type UseCreateLeadOptions, type CreateLeadCallInput } from '@/lib/hooks/useCreateLead';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { isRemoteLeadsError } from '@/lib/leads/errors';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED = { id: 'lead-1', company_id: 'company-a', name: 'Cliente', version: 1 };

function baseOptions(overrides: Partial<UseCreateLeadOptions> = {}): UseCreateLeadOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCreateLeadOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCreateLeadOptions) => useCreateLead(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const managerInput: CreateLeadCallInput = {
  actorRole: 'manager',
  sellerId: 's1',
  name: 'Cliente',
  phone: '11999990000',
  car: 'Golf',
};

const sellerInput: CreateLeadCallInput = {
  actorRole: 'seller',
  name: 'Cliente',
  phone: '11999990000',
  car: 'Golf',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
});

describe('useCreateLead — payload por actorRole', () => {
  it('Manager: envia sellerId, nunca p_company_id', async () => {
    const { hook } = setup();
    await hook.result.current.createLead(managerInput);
    expect(mocks.rpc).toHaveBeenCalledWith('create_lead', {
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_seller_id: 's1',
      p_temperature: undefined,
      p_payment_preference: undefined,
      p_source: undefined,
    });
  });

  it('Manager: sellerId null é permitido (sem vendedor)', async () => {
    const { hook } = setup();
    await hook.result.current.createLead({ ...managerInput, sellerId: null });
    expect(mocks.rpc.mock.calls[0][1].p_seller_id).toBeUndefined();
  });

  it('Seller: p_seller_id sempre undefined (tipo estruturalmente sem esse campo — backend autoatribui)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.createLead(sellerInput);
    expect(mocks.rpc.mock.calls[0][1].p_seller_id).toBeUndefined();
  });
});

describe('useCreateLead — bloqueios de identidade', () => {
  it('sem companyId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.createLead(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteLeadsError(e));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.createLead(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('usuário inativo: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.createLead(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin/nenhuma): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.createLead(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('actorRole do input diverge do membershipRole do hook: bloqueia (Seller nunca chama como manager)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createLead(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateLead — sucesso e invalidação', () => {
  it('invalida SOMENTE leadQueryKeys.active(companyId capturado)', async () => {
    const { hook, invalidateSpy } = setup();
    const created = await hook.result.current.createLead(managerInput);
    expect(created).toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
  });

  it('nenhum StoreAdapter/reset global — só invalidateQueries com a key certa', async () => {
    const { hook, queryClient } = setup();
    const clearSpy = vi.spyOn(queryClient, 'clear');
    await hook.result.current.createLead(managerInput);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateLead — erro remoto', () => {
  it('erro do Supabase vira RemoteLeadsError mapeado, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createLead(managerInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_seller_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('retry 0 — sem reenvio automático (create_lead não é idempotente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createLead(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useCreateLead — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createLead(managerInput);
    // Aguarda o mock realmente ter sido chamado (mutateAsync não invoca
    // mutationFn de forma síncrona) ANTES de simular a troca de identidade
    // e resolver — senão resolveRpc ainda seria o no-op inicial.
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    // Simula troca de identidade (logout/troca de empresa) ENQUANTO a
    // mutation está em voo — resetQueryCache real faria isso via
    // bumpQueryCacheGeneration.
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('identidade estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.createLead(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: CREATED, error: null });

    await expect(promise).resolves.toEqual(CREATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
  });
});
