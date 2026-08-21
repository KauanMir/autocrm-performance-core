// Testes de useDeals (COMMERCIAL-REMOTE-DEALS-B2-A). Mock isolado de
// lib/supabase/client (cadeia from→select→order→order) e mock controlável
// de resolveDealRemoteMode. Nenhuma rede real, nenhum store, nenhuma
// dependência de Lead/Seller catalog. Mesmo padrão de
// tests/hooks/useVisits.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeals, type UseDealsOptions } from '@/lib/hooks/useDeals';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import type { RemoteDealRow } from '@/lib/deals/adapter';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  resolveDealRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/deals/remoteDealsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/deals/remoteDealsMode')>();
  return { ...actual, resolveDealRemoteMode: mocks.resolveDealRemoteMode };
});

function dealRow(overrides: Partial<RemoteDealRow> = {}): RemoteDealRow {
  return {
    id: 'deal-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name_snapshot: 'Carlos Andrade',
    assigned_seller_id: 's1',
    vehicle: 'Golf GTI 2022',
    value_cents: 12000000,
    discount_percent: 3,
    payment_method: 'financiamento_100',
    down_payment_cents: null,
    installments: null,
    note: '',
    status: 'open',
    lost_by: null,
    lost_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    created_at: '2026-08-21T10:00:00+00:00',
    updated_at: '2026-08-21T10:00:00+00:00',
    version: 1,
    ...overrides,
  };
}

const MANAGER_OPTIONS: UseDealsOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager',
  userIsActive: true,
};

const SELLER_OPTIONS: UseDealsOptions = {
  ...MANAGER_OPTIONS,
  membershipRole: 'seller',
};

function mockDealsResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select });
  return { select, order1, order2 };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.resolveDealRemoteMode.mockReturnValue('deal_local');
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe('useDeals — modos desabilitados (zero request)', () => {
  it.each([
    ['deal_local', 'deal_local'],
    ['deal_blocked', 'deal_blocked'],
    ['deal_remote_misconfigured', 'deal_remote_misconfigured'],
  ] as const)('mode=%s ⇒ queryEnabled=false, nenhuma chamada', (_label, mode) => {
    mocks.resolveDealRemoteMode.mockReturnValue(mode);
    mockDealsResponse({ data: [dealRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useDeals — remote_ready com identidade incompleta (zero request)', () => {
  beforeEach(() => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    mockDealsResponse({ data: [dealRow()], error: null });
  });

  it('sem userId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals({ ...MANAGER_OPTIONS, userId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId ⇒ nenhuma chamada, key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals({ ...MANAGER_OPTIONS, companyId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'deals', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals({ ...MANAGER_OPTIONS, userIsActive: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller) ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDeals({ ...MANAGER_OPTIONS, membershipRole: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useDeals — remote_ready com identidade completa', () => {
  beforeEach(() => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('Manager: executa UMA leitura com a key da empresa', async () => {
    mockDealsResponse({ data: [dealRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(dealQueryKeys.active('company-a'));
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('Seller: também habilita a query', async () => {
    mockDealsResponse({ data: [dealRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(SELLER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    await waitFor(() => expect(result.current.hasData).toBe(true));
  });

  it('sucesso: rows CRUAS na ordem recebida, nenhuma adaptação', async () => {
    mockDealsResponse({
      data: [dealRow({ id: 'deal-a' }), dealRow({ id: 'deal-b', status: 'lost', lost_by: 'p2', lost_at: '2026-08-21T12:00:00+00:00' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(['deal-a', 'deal-b']);
    expect(result.current.rows[0].value_cents).toBe(12000000);
    expect(result.current.rows[0]).not.toHaveProperty('clientName');
    expect(result.current.rows[0]).not.toHaveProperty('valueCents');
  });

  it('lista vazia permanece vazia (isEmpty true, hasData false)', async () => {
    mockDealsResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    expect(result.current.rows).toEqual([]);
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('erro remoto é exposto sem fallback local', async () => {
    mockDealsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect((result.current.error as { message?: string })?.message).toBe('remote_deals_fetch_failed');
  });

  it('não escreve em localStorage durante a leitura remota', async () => {
    mockDealsResponse({ data: [dealRow()], error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('companies diferentes não compartilham cache', async () => {
    mockDealsResponse({ data: [dealRow()], error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => useDeals(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockDealsResponse({ data: [], error: null });
    const b = renderHook(() => useDeals({ ...MANAGER_OPTIONS, companyId: 'company-b' }), { wrapper });
    expect(b.result.current.queryKey).toEqual(dealQueryKeys.active('company-b'));
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    expect(a.result.current.rows).toHaveLength(1);
    expect(b.result.current.rows).toHaveLength(0);
    expect(queryClient.getQueryData(dealQueryKeys.active('company-a'))).not.toEqual(
      queryClient.getQueryData(dealQueryKeys.active('company-b')),
    );
  });
});
