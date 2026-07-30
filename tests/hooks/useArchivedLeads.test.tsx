// Testes de useArchivedLeads (M1-E, E6-B1). Supabase mockado (from) e mock
// controlável de isRemoteLeadsEnabled/isRemoteStagesEnabled (resolveRemoteLeadsFlagMode).
// Nenhuma rede real, nenhum store, nenhuma bridge.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArchivedLeads, type UseArchivedLeadsOptions } from '@/lib/hooks/useArchivedLeads';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import type { LeadRow } from '@/lib/supabase/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled,
    isRemoteStagesEnabled: mocks.isRemoteStagesEnabled,
  };
});

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
    archived_at: '2026-07-30T10:00:00+00:00',
    version: 2,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-30T10:00:00+00:00',
    ...overrides,
  };
}

function mockArchivedResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const not = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ not }));
  mocks.from.mockReturnValue({ select });
  return { select, not, order1, order2 };
}

const FULL_OPTIONS: UseArchivedLeadsOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager',
  userIsActive: true,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReturnValue(false);
  mocks.isRemoteStagesEnabled.mockReturnValue(false);
});

describe('useArchivedLeads — flag OFF (local)', () => {
  it('nenhuma query é executada e nada é exposto', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.leads).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useArchivedLeads — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('nenhuma query é executada', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    mockArchivedResponse({ data: [leadRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useArchivedLeads — gating (remote_ready)', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    mockArchivedResponse({ data: [leadRow()], error: null });
  });

  it('Seller: nenhuma query é executada (decisão humana do E6-A0 — Seller nunca vê arquivados)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useArchivedLeads({ ...FULL_OPTIONS, membershipRole: 'seller' }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem membership (Super Admin): nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useArchivedLeads({ ...FULL_OPTIONS, membershipRole: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId: nenhuma query, key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useArchivedLeads({ ...FULL_OPTIONS, companyId: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'leads', 'archived', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo: nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useArchivedLeads({ ...FULL_OPTIONS, userIsActive: false }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem userId: nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useArchivedLeads({ ...FULL_OPTIONS, userId: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('Manager operacional em remote_ready: executa UMA leitura com a key de arquivados da empresa', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(leadQueryKeys.archived('company-a'));
    await waitFor(() => expect(result.current.leads.length).toBeGreaterThan(0));
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('leads');
  });
});

describe('useArchivedLeads — resultados', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
  });

  it('retorna as linhas cruas na ordem recebida', async () => {
    mockArchivedResponse({
      data: [leadRow({ id: 'lead-b' }), leadRow({ id: 'lead-a' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.leads.length).toBe(2));
    expect(result.current.leads.map((l) => l.id)).toEqual(['lead-b', 'lead-a']);
  });

  it('lista vazia permanece vazia (nunca erro)', async () => {
    mockArchivedResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.leads).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('erro do Supabase vira isError=true, nunca lista vazia mascarada como sucesso', async () => {
    mockArchivedResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useArchivedLeads(FULL_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.leads).toEqual([]);
  });
});
