// Testes de useUnarchiveLead (M1-E, E6-B1). Supabase mockado (rpc). Cobre:
// payload exato (sem p_company_id, sem p_restore_stage_id), Manager-only
// (Seller SEMPRE bloqueado — decisão humana do E6-A0), expectedVersion
// obrigatório, invalidation (active+archived), ausência de mutation
// otimista, retry 0, proteção de identidade (geração de cache),
// idempotência (Lead já ativo retorna a linha sem erro).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUnarchiveLead,
  type UseUnarchiveLeadOptions,
  type UnarchiveLeadCallInput,
} from '@/lib/hooks/useUnarchiveLead';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const UNARCHIVED = {
  id: 'lead-1', company_id: 'company-a', archived_at: null,
  stage_id: 'stage-1', seller_id: 's1', version: 3,
};

function baseOptions(overrides: Partial<UseUnarchiveLeadOptions> = {}): UseUnarchiveLeadOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseUnarchiveLeadOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseUnarchiveLeadOptions) => useUnarchiveLead(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: UnarchiveLeadCallInput = { leadId: 'lead-1', expectedVersion: 2 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UNARCHIVED, error: null });
});

describe('useUnarchiveLead — payload', () => {
  it('envia exatamente p_lead_id/p_expected_version, nunca p_company_id nem p_restore_stage_id', async () => {
    const { hook } = setup();
    await hook.result.current.unarchiveLead(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('unarchive_lead', {
      p_lead_id: 'lead-1',
      p_expected_version: 2,
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_restore_stage_id');
  });

  it('restauração preserva stage_id/seller_id existentes (contrato mantido, achado do E6-A1)', async () => {
    const { hook } = setup();
    const result = await hook.result.current.unarchiveLead(baseInput);
    expect(result.stage_id).toBe('stage-1');
    expect(result.seller_id).toBe('s1');
  });
});

describe('useUnarchiveLead — Manager-only (sem exceção)', () => {
  it('Manager: chama a RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await hook.result.current.unarchiveLead(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('Seller: SEMPRE bloqueado ANTES da RPC, mesmo sobre o próprio Lead (unarchive_lead proíbe Seller de forma incondicional no backend)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_forbidden',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUnarchiveLead — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('profile inativo bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion ausente (não numérico) bloqueia sem chamar o Supabase, mesmo código de stale_write', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.unarchiveLead({ ...baseInput, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_leads_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUnarchiveLead — sucesso, invalidação e ausência de otimismo (E7-B2-B2)', () => {
  it('invalida active, archived E timeline(companyId, leadId) — o Lead muda de lista e grava evento automático desde o E7-B2-B1', async () => {
    const { hook, invalidateSpy } = setup();
    const unarchived = await hook.result.current.unarchiveLead(baseInput);
    expect(unarchived).toEqual(UNARCHIVED);
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.archived('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', UNARCHIVED.id) });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.unarchiveLead(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it('idempotente: Lead já ativo retorna a linha sem erro (mesmo expectedVersion divergente do estado real)', async () => {
    const { hook } = setup();
    const unarchived = await hook.result.current.unarchiveLead({ leadId: 'lead-1', expectedVersion: 999 });
    expect(unarchived).toEqual(UNARCHIVED);
  });
});

describe('useUnarchiveLead — erro e retry', () => {
  it('stale_write do backend vira RemoteLeadsError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_stale_write',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('retry 0 — sem reenvio automático', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_not_found' } });
    const { hook } = setup();
    await expect(hook.result.current.unarchiveLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useUnarchiveLead — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.unarchiveLead(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: UNARCHIVED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
