// Testes de useCreateVisit (COMMERCIAL-REMOTE-VISITS-B2-B). Supabase
// mockado (rpc), sem rede real. Cobre: payload por actorRole, mode
// gating, identity gating, role mismatch, retry 0, invalidação de
// sucesso (Visits + timeline do Lead quando presente), e a proteção de
// geração de cache em AMBOS os caminhos. Mesmo padrão de
// tests/hooks/useCreateTask.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateVisit, type UseCreateVisitOptions, type CreateVisitCallInput } from '@/lib/hooks/useCreateVisit';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { companySellerLeaderboardQueryPrefix } from '@/lib/hooks/useCompanySellerLeaderboard';
import { sellerCompetitionEventsQueryKey } from '@/lib/hooks/useSellerCompetitionEvents';
import { isRemoteVisitsError } from '@/lib/visits/errors';
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

const CREATED_WITH_LEAD = {
  id: 'visit-1', company_id: 'company-a', lead_id: 'lead-1', client_name: null,
  assigned_seller_id: 's1', vehicles: ['Golf GTI 2022'], scheduled_at: '2026-08-21T17:00:00+00:00',
  status: 'scheduled', outcome: null, note: '', result_note: null, created_by: 'profile-1',
  updated_by: 'profile-1', closed_by: null, created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-20T10:00:00+00:00', closed_at: null, version: 1,
};

const CREATED_NO_LEAD = { ...CREATED_WITH_LEAD, id: 'visit-2', lead_id: null, client_name: 'Cliente Avulso' };

function baseOptions(overrides: Partial<UseCreateVisitOptions> = {}): UseCreateVisitOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCreateVisitOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCreateVisitOptions) => useCreateVisit(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const managerInput: CreateVisitCallInput = {
  actorRole: 'manager',
  assignedSellerId: 's1',
  scheduledAt: '2026-08-21T17:00:00+00:00',
  vehicles: ['Golf GTI 2022'],
  leadId: 'lead-1',
};

const sellerInput: CreateVisitCallInput = {
  actorRole: 'seller',
  scheduledAt: '2026-08-21T17:00:00+00:00',
  vehicles: ['Golf GTI 2022'],
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: CREATED_WITH_LEAD, error: null });
  mocks.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_remote_ready');
});

describe('useCreateVisit — payload por actorRole', () => {
  it('Manager: envia assignedSellerId, nunca p_company_id/status/version', async () => {
    const { hook } = setup();
    await hook.result.current.createVisit(managerInput);
    expect(mocks.rpc).toHaveBeenCalledWith('create_visit', {
      p_scheduled_at: '2026-08-21T17:00:00+00:00',
      p_vehicles: ['Golf GTI 2022'],
      p_lead_id: 'lead-1',
      p_client_name: null,
      p_assigned_seller_id: 's1',
      p_note: '',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('version');
  });

  it('Seller: p_assigned_seller_id sempre null (tipo estruturalmente sem esse campo — backend autoatribui)', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED_NO_LEAD, error: null });
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.createVisit(sellerInput);
    expect(mocks.rpc.mock.calls[0][1].p_assigned_seller_id).toBeNull();
  });
});

describe('useCreateVisit — mode gating', () => {
  it.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)(
    'mode=%s: bloqueia sem chamar o Supabase',
    async (mode) => {
      mocks.resolveVisitRemoteMode.mockReturnValue(mode);
      const { hook } = setup();
      await expect(hook.result.current.createVisit(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteVisitsError(e));
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});

describe('useCreateVisit — identity gating', () => {
  it('sem companyId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.createVisit(managerInput)).rejects.toSatisfy((e: unknown) => isRemoteVisitsError(e));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.createVisit(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('usuário inativo: bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.createVisit(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller): bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.createVisit(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCreateVisit — consistência de role (CRÍTICO)', () => {
  it('hook Manager + input actorRole seller: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createVisit(sellerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Seller + input actorRole manager: bloqueia antes da RPC', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createVisit(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('hook Manager + input actorRole manager: permitido', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await expect(hook.result.current.createVisit(managerInput)).resolves.toEqual(CREATED_WITH_LEAD);
  });

  it('hook Seller + input actorRole seller: permitido', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED_NO_LEAD, error: null });
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.createVisit(sellerInput)).resolves.toEqual(CREATED_NO_LEAD);
  });
});

describe('useCreateVisit — retry e invalidação de sucesso', () => {
  it('retry 0 — sem reenvio automático (create_visit não é idempotente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.createVisit(managerInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso com lead_id: invalida Visits + timeline do Lead + leaderboard + eventos de competição (COMPETITION-V2 §18)', async () => {
    const { hook, invalidateSpy } = setup();
    const created = await hook.result.current.createVisit(managerInput);
    expect(created).toEqual(CREATED_WITH_LEAD);
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companySellerLeaderboardQueryPrefix('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sellerCompetitionEventsQueryKey('company-a', 'user-1') });
  });

  it('sucesso sem lead_id: invalida Visits + leaderboard + eventos (sem timeline)', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED_NO_LEAD, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.createVisit({ ...managerInput, leadId: null, clientName: 'Cliente Avulso' });
    // exatamente 3: Visits + leaderboard + sellerCompetitionEvents — nunca timeline (sem lead_id).
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companySellerLeaderboardQueryPrefix('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sellerCompetitionEventsQueryKey('company-a', 'user-1') });
  });


  it('erro do backend (seller_not_found) vira RemoteVisitsError mapeado, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.createVisit(managerInput)).rejects.toMatchObject({
      code: 'remote_visits_mutation_seller_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useCreateVisit — proteção de geração de cache (AMBOS os caminhos)', () => {
  it('geração muda ENQUANTO a RPC ainda não resolveu, resposta RESOLVE com sucesso: identity_changed, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createVisit(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: CREATED_WITH_LEAD, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO: geração muda ENQUANTO a RPC ainda não resolveu, resposta REJEITA — identity_changed, NUNCA o código de erro da geração antiga, zero invalidação', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.createVisit(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });

    await expect(promise).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    await expect(promise).rejects.not.toMatchObject({ code: 'remote_visits_mutation_seller_not_found' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('geração estável: invalida normalmente', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, invalidateSpy } = setup();

    const promise = hook.result.current.createVisit(managerInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    resolveRpc({ data: CREATED_WITH_LEAD, error: null });

    await expect(promise).resolves.toEqual(CREATED_WITH_LEAD);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: visitQueryKeys.active('company-a') });
  });
});
