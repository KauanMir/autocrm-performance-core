// Testes de useCheckLeadPhoneDuplicate (M1-E, E4-B1). Supabase mockado
// (rpc). Cobre: phone/excludeLeadId, ausência de p_company_id, none/
// accessible/restricted preservados, resposta fora de ordem (sequence),
// proteção de identidade, retry 0, erro nunca vira 'none' silencioso.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCheckLeadPhoneDuplicate,
  type UseCheckLeadPhoneDuplicateOptions,
} from '@/lib/hooks/useCheckLeadPhoneDuplicate';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function baseOptions(
  overrides: Partial<UseCheckLeadPhoneDuplicateOptions> = {},
): UseCheckLeadPhoneDuplicateOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

function setup(options: Partial<UseCheckLeadPhoneDuplicateOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((opts: UseCheckLeadPhoneDuplicateOptions) => useCheckLeadPhoneDuplicate(opts), {
    wrapper,
    initialProps: baseOptions(options),
  });
  return { queryClient, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

describe('useCheckLeadPhoneDuplicate — payload', () => {
  it('chama check_lead_phone_duplicate SEM p_company_id', async () => {
    const { hook } = setup();
    await hook.result.current.checkDuplicate({ phone: '11999990000' });
    expect(mocks.rpc).toHaveBeenCalledWith('check_lead_phone_duplicate', {
      p_phone: '11999990000',
      p_exclude_lead_id: undefined,
    });
  });

  it('excludeLeadId é repassado', async () => {
    const { hook } = setup();
    await hook.result.current.checkDuplicate({ phone: '11999990000', excludeLeadId: 'lead-1' });
    expect(mocks.rpc.mock.calls[0][1].p_exclude_lead_id).toBe('lead-1');
  });
});

describe('useCheckLeadPhoneDuplicate — retorno preservado', () => {
  it('none/accessible/restricted chegam intactos em outcome.rows', async () => {
    const rows = [
      { status: 'accessible', lead_id: 'l1', lead_name: 'Ana', lead_archived: false },
      { status: 'restricted', lead_id: null, lead_name: null, lead_archived: null },
    ];
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const { hook } = setup();
    const outcome = await hook.result.current.checkDuplicate({ phone: '11999990000' });
    expect(outcome.rows).toEqual(rows);
  });

  it('outcome carrega phone bruto e phoneDigits normalizado', async () => {
    const { hook } = setup();
    const outcome = await hook.result.current.checkDuplicate({ phone: '(11) 90000-0001' });
    expect(outcome.phone).toBe('(11) 90000-0001');
    expect(outcome.phoneDigits).toBe('11900000001');
  });
});

describe('useCheckLeadPhoneDuplicate — sequence (descarte de resposta fora de ordem)', () => {
  it('sequence é monotônico entre chamadas sucessivas', async () => {
    const { hook } = setup();
    const first = await hook.result.current.checkDuplicate({ phone: '11900000001' });
    const second = await hook.result.current.checkDuplicate({ phone: '11900000002' });
    expect(second.sequence).toBeGreaterThan(first.sequence);
  });

  it('getLatestSequence() reflete a chamada mais recente já iniciada', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { hook } = setup();

    // Duas chamadas disparadas em sequência, sem aguardar a primeira —
    // simula o telefone mudando no meio de um debounce ainda em voo.
    const firstPromise = hook.result.current.checkDuplicate({ phone: '11900000001' });
    const secondPromise = hook.result.current.checkDuplicate({ phone: '11900000002' });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.sequence).toBeLessThan(second.sequence);
    expect(hook.result.current.getLatestSequence()).toBe(second.sequence);
    // O E4-B2 descartaria `first` comparando seu sequence contra
    // getLatestSequence() no momento em que a resposta chegasse.
    expect(first.sequence).not.toBe(hook.result.current.getLatestSequence());
  });
});

describe('useCheckLeadPhoneDuplicate — bloqueios de identidade', () => {
  it('sem companyId bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.checkDuplicate({ phone: '119999' })).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin) bloqueia sem chamar o Supabase', async () => {
    const { hook } = setup({ membershipRole: null });
    await expect(hook.result.current.checkDuplicate({ phone: '119999' })).rejects.toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCheckLeadPhoneDuplicate — erro nunca vira none silencioso', () => {
  it('invalid_phone do backend é preservado, nunca virou resultado vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_phone' } });
    const { hook } = setup();
    await expect(hook.result.current.checkDuplicate({ phone: 'abc' })).rejects.toMatchObject({
      code: 'remote_leads_mutation_invalid_phone',
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
  });

  it('retry 0 — sem reenvio automático', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    const { hook } = setup();
    await expect(hook.result.current.checkDuplicate({ phone: '119999' })).rejects.toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('useCheckLeadPhoneDuplicate — proteção de identidade (geração de cache)', () => {
  it('identidade mudou entre início e resposta: lança identity_changed', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient } = setup();

    const promise = hook.result.current.checkDuplicate({ phone: '119999' });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    bumpQueryCacheGeneration(queryClient);
    resolveRpc({ data: [], error: null });

    await expect(promise).rejects.toMatchObject({ code: 'remote_leads_mutation_identity_changed' });
  });
});
