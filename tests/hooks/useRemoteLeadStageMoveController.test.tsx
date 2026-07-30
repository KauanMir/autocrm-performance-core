// Testes de useRemoteLeadStageMoveController (M1-E, E5-B1). Supabase
// mockado (rpc, via useMoveLeadToStage real). Cobre: pendência escopada por
// Lead (Leads diferentes movem ao mesmo tempo, o mesmo Lead nunca dispara
// duas mutations simultâneas), token por Lead (resposta obsoleta nunca
// sobrescreve um movimento mais novo do MESMO Lead), same-stage no-op
// (isNoOpStageMove, sem chamar a RPC), erro exposto por Lead (identity_
// changed nunca vira erro visível), descarte de pendência/erro na troca de
// identidade.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useRemoteLeadStageMoveController,
  type UseRemoteLeadStageMoveControllerOptions,
} from '@/lib/hooks/useRemoteLeadStageMoveController';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const MOVED_A = { id: 'lead-a', company_id: 'company-a', stage_id: 'stage-2', version: 2 };
const MOVED_B = { id: 'lead-b', company_id: 'company-a', stage_id: 'stage-2', version: 2 };

function baseOptions(
  overrides: Partial<UseRemoteLeadStageMoveControllerOptions> = {},
): UseRemoteLeadStageMoveControllerOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    identityKey: 'user-1:company-a',
    ...overrides,
  };
}

function setup(options: Partial<UseRemoteLeadStageMoveControllerOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (opts: UseRemoteLeadStageMoveControllerOptions) => useRemoteLeadStageMoveController(opts),
    { wrapper, initialProps: baseOptions(options) },
  );
  return { queryClient, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: MOVED_A, error: null });
});

describe('useRemoteLeadStageMoveController — same-stage no-op', () => {
  it('sourceStageId === targetStageId: nunca chama a RPC, nunca fica pendente', () => {
    const { hook } = setup();
    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-1' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(hook.result.current.isLeadPending('lead-a')).toBe(false);
  });
});

describe('useRemoteLeadStageMoveController — pendência por Lead', () => {
  it('Lead A pendente bloqueia um segundo attemptMove do MESMO Lead', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(true));

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-3' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    resolveRpc({ data: MOVED_A, error: null });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
  });

  it('Lead A pendente não bloqueia um attemptMove de Lead B (movimentos simultâneos)', async () => {
    let resolveA: (value: unknown) => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    let calls = 0;
    mocks.rpc.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveA = resolve; });
      return new Promise((resolve) => { resolveB = resolve; });
    });
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(true));

    hook.result.current.attemptMove({ leadId: 'lead-b', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-b')).toBe(true));
    expect(hook.result.current.isLeadPending('lead-a')).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);

    resolveA({ data: MOVED_A, error: null });
    resolveB({ data: MOVED_B, error: null });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-b')).toBe(false));
  });
});

describe('useRemoteLeadStageMoveController — token por Lead (resposta obsoleta)', () => {
  it('duas chamadas síncronas de attemptMove do MESMO Lead (antes de re-render): só o token mais novo decide o resultado final', async () => {
    // Duas chamadas sem await entre elas veem o MESMO pendingLeadIds da
    // closure atual (ainda vazio) — as duas passam pelo guard e disparam
    // RPC, uma com token=1 e outra com token=2 (o cenário real que o token
    // protege: a resposta mais antiga chegando depois não pode vencer).
    let resolveFirst: (value: unknown) => void = () => {};
    let resolveSecond: (value: unknown) => void = () => {};
    let calls = 0;
    mocks.rpc.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return new Promise((resolve) => { resolveSecond = resolve; });
    });
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-3' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));

    // Resposta obsoleta (token=1) chega primeiro — nunca limpa a pendência
    // que pertence ao token=2 (mais novo).
    resolveFirst({ data: MOVED_A, error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(hook.result.current.isLeadPending('lead-a')).toBe(true);

    // Resposta do token=2 (a mais nova) chega — só ela limpa a pendência.
    resolveSecond({ data: MOVED_A, error: null });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
  });
});

describe('useRemoteLeadStageMoveController — erro por Lead', () => {
  it('erro do backend fica associado ao leadId, pendência é removida', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
    await waitFor(() =>
      expect(hook.result.current.errorCodeByLead['lead-a']).toBe('remote_leads_mutation_stage_not_found'),
    );
  });

  it('identity_changed nunca produz erro visível para o Lead', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: MOVED_A, error: null });

    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
    expect(hook.result.current.errorCodeByLead['lead-a']).toBeUndefined();
  });

  it('clearError remove o erro daquele Lead', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.errorCodeByLead['lead-a']).toBeDefined());

    hook.result.current.clearError('lead-a');
    await waitFor(() => expect(hook.result.current.errorCodeByLead['lead-a']).toBeUndefined());
  });

  it('nova tentativa do mesmo Lead limpa o erro anterior antes de chamar a RPC de novo', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.errorCodeByLead['lead-a']).toBeDefined());

    mocks.rpc.mockResolvedValueOnce({ data: MOVED_A, error: null });
    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-3' });
    await waitFor(() => expect(hook.result.current.isLeadPending('lead-a')).toBe(false));
    expect(hook.result.current.errorCodeByLead['lead-a']).toBeUndefined();
  });
});

describe('useRemoteLeadStageMoveController — troca de identidade', () => {
  it('identityKey muda: pendência e erro são descartados', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook, queryClient } = setup();
    void queryClient;

    hook.result.current.attemptMove({ leadId: 'lead-a', sourceStageId: 'stage-1', targetStageId: 'stage-2' });
    await waitFor(() => expect(hook.result.current.errorCodeByLead['lead-a']).toBeDefined());

    hook.rerender(baseOptions({ identityKey: 'user-2:company-b', companyId: 'company-b' }));
    await waitFor(() => expect(hook.result.current.errorCodeByLead['lead-a']).toBeUndefined());
    expect(hook.result.current.isLeadPending('lead-a')).toBe(false);
  });
});
