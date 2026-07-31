// Testes de useAssignLeadSeller (M1-E, E6-B1). Supabase mockado (rpc). Cobre:
// payload exato (sem p_company_id), Manager-only (Seller SEMPRE bloqueado,
// mesmo com sellerId próprio — decisão humana do E6-A0), expectedVersion
// obrigatório, invalidation (só active), ausência de mutation otimista,
// retry 0, proteção de identidade (geração de cache), helper isNoOpSellerAssignment.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAssignLeadSeller,
  isNoOpSellerAssignment,
  type UseAssignLeadSellerOptions,
  type AssignLeadSellerCallInput,
} from '@/lib/hooks/useAssignLeadSeller';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const ASSIGNED = { id: 'lead-1', company_id: 'company-a', seller_id: 's2', version: 2 };

function baseOptions(overrides: Partial<UseAssignLeadSellerOptions> = {}): UseAssignLeadSellerOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseAssignLeadSellerOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseAssignLeadSellerOptions) => useAssignLeadSeller(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: AssignLeadSellerCallInput = { leadId: 'lead-1', sellerId: 's2', expectedVersion: 1 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: ASSIGNED, error: null });
});

describe('useAssignLeadSeller — payload', () => {
  it('envia exatamente p_lead_id/p_seller_id/p_expected_version, nunca p_company_id', async () => {
    const { hook } = setup();
    await hook.result.current.assignLeadSeller(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('assign_lead_seller', {
      p_lead_id: 'lead-1',
      p_seller_id: 's2',
      p_expected_version: 1,
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
  });

  it('sellerId null: envia p_seller_id null (remove o vendedor)', async () => {
    const { hook } = setup();
    await hook.result.current.assignLeadSeller({ ...baseInput, sellerId: null });
    expect(mocks.rpc.mock.calls[0][1].p_seller_id).toBeNull();
  });
});

describe('useAssignLeadSeller — Manager-only (sem exceção)', () => {
  it('Manager: chama a RPC', async () => {
    const { hook } = setup({ membershipRole: 'manager' });
    await hook.result.current.assignLeadSeller(baseInput);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('Seller: SEMPRE bloqueado ANTES da RPC, mesmo em tese sobre o próprio Lead (assign_lead_seller proíbe Seller de forma incondicional no backend)', async () => {
    const { hook } = setup({ membershipRole: 'seller' });
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_forbidden',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useAssignLeadSeller — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('profile inativo bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ userIsActive: false });
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('expectedVersion ausente (não numérico) bloqueia sem chamar o Supabase, mesmo código de stale_write', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.assignLeadSeller({ ...baseInput, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_leads_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useAssignLeadSeller — sucesso, invalidação e ausência de otimismo (E7-B2-B2)', () => {
  it('invalida active(companyId capturado) E timeline(companyId, leadId), nunca archived — assign_lead_seller grava evento automático desde o E7-B2-B1', async () => {
    const { hook, invalidateSpy } = setup();
    const assigned = await hook.result.current.assignLeadSeller(baseInput);
    expect(assigned).toEqual(ASSIGNED);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', ASSIGNED.id) });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.archived('company-a') });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.assignLeadSeller(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('useAssignLeadSeller — erro e retry', () => {
  it('seller_not_found do backend vira RemoteLeadsError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_seller_not_found',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('retry 0 — sem reenvio automático (expectedVersion obsoleto nunca deve ser reenviado)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook } = setup();
    await expect(hook.result.current.assignLeadSeller(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useAssignLeadSeller — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.assignLeadSeller(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: ASSIGNED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('isNoOpSellerAssignment', () => {
  it('mesmo sellerId: no-op', () => {
    expect(isNoOpSellerAssignment('s1', 's1')).toBe(true);
  });
  it('sellerId diferente: não é no-op', () => {
    expect(isNoOpSellerAssignment('s1', 's2')).toBe(false);
  });
  it('null === null (sem vendedor -> sem vendedor): no-op', () => {
    expect(isNoOpSellerAssignment(null, null)).toBe(true);
  });
  it('atual com vendedor, próximo null: não é no-op', () => {
    expect(isNoOpSellerAssignment('s1', null)).toBe(false);
  });
  it('atual null, próximo com vendedor: não é no-op', () => {
    expect(isNoOpSellerAssignment(null, 's1')).toBe(false);
  });
});
