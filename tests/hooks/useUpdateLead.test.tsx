// Testes de useUpdateLead (M1-E, E4-B1). Supabase mockado (rpc). Cobre:
// campos permitidos, ausência de p_company_id/seller/stage, expectedVersion
// obrigatório, stale_write, invalidation (active + detail + timeline
// desde o E7-B2-B2/B2-C), proteção de identidade, retry 0, sem mutation
// otimista.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateLead, type UseUpdateLeadOptions, type UpdateLeadCallInput } from '@/lib/hooks/useUpdateLead';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const UPDATED = { id: 'lead-1', company_id: 'company-a', name: 'Cliente', version: 4 };

function baseOptions(overrides: Partial<UseUpdateLeadOptions> = {}): UseUpdateLeadOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseUpdateLeadOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseUpdateLeadOptions) => useUpdateLead(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, invalidateSpy, hook };
}

const baseInput: UpdateLeadCallInput = {
  leadId: 'lead-1',
  expectedVersion: 3,
  name: 'Cliente',
  phone: '11999990000',
  car: 'Golf',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: UPDATED, error: null });
});

describe('useUpdateLead — payload', () => {
  it('envia exatamente os campos reais, nunca p_company_id/seller/stage/archived/timeline', async () => {
    const { hook } = setup();
    await hook.result.current.updateLead(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('update_lead', {
      p_lead_id: 'lead-1',
      p_expected_version: 3,
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_temperature: undefined,
      p_payment_preference: undefined,
      p_source: undefined,
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_seller_id');
    expect(args).not.toHaveProperty('p_stage_id');
    expect(args).not.toHaveProperty('p_archived_at');
  });
});

describe('useUpdateLead — expectedVersion obrigatório', () => {
  it('expectedVersion ausente/não numérico bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup();
    await expect(
      hook.result.current.updateLead({ ...baseInput, expectedVersion: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'remote_leads_mutation_stale_write' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('stale_write vindo do backend é preservado como código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook } = setup();
    await expect(hook.result.current.updateLead(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_stale_write',
    });
  });
});

describe('useUpdateLead — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.updateLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.updateLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateLead — sucesso, invalidação e ausência de otimismo', () => {
  it('invalida active(companyId), detail(companyId, leadId) e timeline(companyId, leadId) — update_lead grava evento automático desde o E7-B2-B1', async () => {
    const { hook, invalidateSpy } = setup();
    const updated = await hook.result.current.updateLead(baseInput);
    expect(updated).toEqual(UPDATED);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.active('company-a') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail('company-a', 'lead-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-1') });
  });

  // M1-E E7-B2-C — achado de auditoria: a invalidação de detail/timeline
  // deve usar SEMPRE o id devolvido pelo servidor (record.id), nunca
  // input.leadId capturado antes da chamada — mesmo padrão dos outros 5
  // hooks (move/apply/assign/archive/unarchive). update_lead nunca muda o
  // id de um Lead na prática (record.id === input.leadId em todo caso
  // real), mas este teste força uma resposta mockada com id divergente
  // para travar QUAL fonte o código usa — se regredir para input.leadId,
  // este teste falha mesmo sem nenhuma mudança de comportamento real do
  // backend.
  it('invalidação usa record.id (devolvido pelo servidor), nunca input.leadId', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...UPDATED, id: 'lead-id-do-servidor' }, error: null });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.updateLead({ ...baseInput, leadId: 'lead-id-do-input' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail('company-a', 'lead-id-do-servidor') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-id-do-servidor') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail('company-a', 'lead-id-do-input') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.timeline('company-a', 'lead-id-do-input') });
  });

  it('nenhuma escrita otimista: setQueryData nunca é chamado por este hook', async () => {
    const { hook, queryClient } = setup();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    await hook.result.current.updateLead(baseInput);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('useUpdateLead — erro e retry', () => {
  it('erro do Supabase vira RemoteLeadsError, nenhuma invalidação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    const { hook, invalidateSpy } = setup();
    await expect(hook.result.current.updateLead(baseInput)).rejects.toMatchObject({
      code: 'remote_leads_mutation_lead_archived',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('retry 0 — sem reenvio automático (optimistic locking por version)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    const { hook } = setup();
    await expect(hook.result.current.updateLead(baseInput)).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useUpdateLead — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed, nunca invalida', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const promise = hook.result.current.updateLead(baseInput);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: UPDATED, error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
