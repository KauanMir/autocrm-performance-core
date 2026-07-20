// Testes de useLeads (M1-E, E3).
// Mock isolado de lib/supabase/client (cadeia from→select→is→order→order) e
// mock controlável de isRemoteLeadsEnabled. Nenhuma rede real, nenhum store.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeads, type UseLeadsOptions } from '@/lib/hooks/useLeads';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import type { LeadRow } from '@/lib/supabase/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled };
});

// ── Fixtures ─────────────────────────────────────────────────────────────

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    company_id: 'company-a',
    name: 'Carlos Andrade',
    phone: '(11) 99421-1190',
    phone_digits: '11994211190',
    car: 'Golf GTI 2022',
    stage_id: 'stage-new',
    seller_id: 's1',
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato ainda',
    alert_label: 'Fazer primeiro contato',
    payment_preference: null,
    value_amount: null,
    source: null,
    created_by_profile_id: null,
    updated_by_profile_id: null,
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T12:00:00+00:00',
    ...overrides,
  };
}

const STAGES_BY_ID: Readonly<Record<string, PipelineStage>> = {
  'stage-new': { id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false },
};

const FULL_OPTIONS: UseLeadsOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  userIsActive: true,
  stagesById: STAGES_BY_ID,
  sellersById: { s1: { id: 's1', name: 'Marcos Silva' } },
  stagesReady: true,
  sellersReady: true,
};

function mockLeadsResponse(response: { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const is = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ is }));
  mocks.from.mockReturnValue({ select });
  return { select, is, order1, order2 };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReturnValue(false);
});

// ── A. Flag OFF ──────────────────────────────────────────────────────────

describe('useLeads — flag OFF', () => {
  it('nenhuma query é executada e nada é exposto', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    expect(result.current.remoteLeadsEnabled).toBe(false);
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.leads).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

// ── B. Gating ────────────────────────────────────────────────────────────

describe('useLeads — gating de dependências (flag ON)', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mockLeadsResponse({ data: [leadRow()], error: null });
  });

  it('sem sessão (userId null) ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads({ ...FULL_OPTIONS, userId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId ⇒ nenhuma chamada e key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads({ ...FULL_OPTIONS, companyId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'leads', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useLeads({ ...FULL_OPTIONS, userIsActive: false }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('stages não prontos ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useLeads({ ...FULL_OPTIONS, stagesReady: false }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sellers não prontos ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useLeads({ ...FULL_OPTIONS, sellersReady: false }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('dependências completas ⇒ executa UMA leitura com a key da empresa', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(leadQueryKeys.active('company-a'));
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});

// ── C. Sucesso, vazio, erro ──────────────────────────────────────────────

describe('useLeads — resultados (flag ON)', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
  });

  it('rows adaptadas para LeadModel na ordem recebida', async () => {
    mockLeadsResponse({
      data: [leadRow({ id: 'lead-b' }), leadRow({ id: 'lead-a', seller_id: null })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.leads.map((l) => l.id)).toEqual(['lead-b', 'lead-a']);
    expect(result.current.leads[0].stage).toBe('Novo');
    expect(result.current.leads[0].stageCode).toBe('new');
    expect(result.current.leads[1].seller).toBe('—');
    expect(result.current.configError).toBeNull();
  });

  it('lista remota vazia permanece vazia (nunca leads locais, nunca initialData)', async () => {
    mockLeadsResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    // Antes de resolver: nada de placeholder local.
    expect(result.current.leads).toEqual([]);
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.leads).toEqual([]);
    expect(result.current.isError).toBe(false);
    expect(result.current.hasData).toBe(false);
  });

  it('erro remoto é exposto sem fallback local', async () => {
    mockLeadsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.leads).toEqual([]);
    expect(result.current.configError).toBeNull();
    expect((result.current.error as { message?: string })?.message).toBe('remote_leads_fetch_failed');
  });

  it('stage órfão vira configError exposto — sem lista, sem erro de rede', async () => {
    mockLeadsResponse({ data: [leadRow({ stage_id: 'stage-fantasma' })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.configError).not.toBeNull());
    expect(result.current.configError?.code).toBe('stage_not_found');
    expect(result.current.leads).toEqual([]);
    expect(result.current.isError).toBe(false);
    expect(result.current.hasData).toBe(false);
  });

  it('não escreve em localStorage durante a leitura remota', async () => {
    mockLeadsResponse({ data: [leadRow()], error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('companies diferentes não compartilham cache', async () => {
    mockLeadsResponse({ data: [leadRow()], error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => useLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockLeadsResponse({ data: [], error: null });
    const b = renderHook(
      () => useLeads({ ...FULL_OPTIONS, companyId: 'company-b' }),
      { wrapper },
    );
    expect(b.result.current.queryKey).toEqual(leadQueryKeys.active('company-b'));
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    expect(a.result.current.leads).toHaveLength(1);
    expect(b.result.current.leads).toHaveLength(0);
    expect(queryClient.getQueryData(leadQueryKeys.active('company-a'))).not.toEqual(
      queryClient.getQueryData(leadQueryKeys.active('company-b')),
    );
  });
});
