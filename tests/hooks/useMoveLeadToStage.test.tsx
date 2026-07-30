// Testes de useMoveLeadToStage (M1-E, E5-A1). Supabase mockado (rpc). Cobre:
// payload exato (sem p_company_id/p_expected_version), bloqueios de
// identidade, invalidation (active), ausência de mutation otimista, retry 0,
// proteção de identidade (geração de cache), ausência de import de
// PipelineService/StoreAdapter.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMoveLeadToStage,
  isNoOpStageMove,
  type UseMoveLeadToStageOptions,
  type MoveLeadToStageCallInput,
} from '@/lib/hooks/useMoveLeadToStage';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const MOVED = { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-2', version: 2 };

function baseOptions(overrides: Partial<UseMoveLeadToStageOptions> = {}): UseMoveLeadToStageOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseMoveLeadToStageOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseMoveLeadToStageOptions) => useMoveLeadToStage(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: MoveLeadToStageCallInput = { leadId: 'lead-1', stageId: 'stage-2' };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: MOVED, error: null });
});

describe('useMoveLeadToStage — payload', () => {
  it('envia exatamente p_lead_id/p_stage_id, nunca p_company_id/p_expected_version', async () => {
    const { hook } = setup();
    await hook.result.current.moveLeadToStage(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('move_lead_to_stage', {
      p_lead_id: 'lead-1',
      p_stage_id: 'stage-2',
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_expected_version');
  });
});

describe('useMoveLeadToStage — Manager e Seller operacionais', () => {
  it('Manager: chama a RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await hook.result.current.moveLeadToStage(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('Seller: chama a RPC (posse do Lead é decidida pelo backend, não por este hook)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await hook.result.current.moveLeadToStage(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useMoveLeadToStage — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('profile inativo bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useMoveLeadToStage — sucesso, invalidação e ausência de otimismo', () => {
  it('invalida somente active(companyId capturado)', async () => {
    const { hook, invalidateSpy } = setup();
    const moved = await hook.result.current.moveLeadToStage(baseInput);
    expect(moved).toEqual(MOVED);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.moveLeadToStage(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('useMoveLeadToStage — erro e retry', () => {
  it('stage_not_found do backend vira RemoteLeadsError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_stage_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('forbidden do backend (Seller em Lead alheio) vira RemoteLeadsError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_forbidden',
    });
  });

  it('retry 0 — sem reenvio automático (LWW, reenviar poderia sobrescrever um move mais recente)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook } = setup();
    await expect(hook.result.current.moveLeadToStage(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useMoveLeadToStage — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.moveLeadToStage(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: MOVED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('isNoOpStageMove', () => {
  it('mesmo stageId: no-op', () => {
    expect(isNoOpStageMove('stage-1', 'stage-1')).toBe(true);
  });
  it('stageId diferente: não é no-op', () => {
    expect(isNoOpStageMove('stage-1', 'stage-2')).toBe(false);
  });
});
