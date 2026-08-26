// Testes de usePlatformDealsScreenState (SUPER-ADMIN-COMPANY-CONTEXT-V2A-
// READ-B1-EXEC). Mesmo padrão de tests/hooks/usePlatformTasksScreenState.test.tsx
// — mas SEM usePlatformLeads: o adapter de Deals não precisa (client_name_
// snapshot já vem na row), mesmo motivo já documentado em
// useRemoteDealsScreenState.ts. fetchPlatformDealRows mockado,
// useAdaptedRemoteDeals roda REAL.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformDealsScreenState } from '@/lib/hooks/usePlatformDealsScreenState';
import type { RemoteDealRow } from '@/lib/deals/adapter';

const mocks = vi.hoisted(() => ({
  fetchPlatformDealRows: vi.fn(),
}));

vi.mock('@/lib/deals/remoteRepository', () => ({
  fetchPlatformDealRows: mocks.fetchPlatformDealRows,
}));

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

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  mocks.fetchPlatformDealRows.mockReset();
});

describe('usePlatformDealsScreenState — gating', () => {
  it('companyId null: mode deal_remote_unavailable_identity, fetchPlatformDealRows nunca chamado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformDealsScreenState(null), { wrapper });
    expect(result.current.mode).toBe('deal_remote_unavailable_identity');
    expect(result.current.deals).toEqual([]);
    expect(mocks.fetchPlatformDealRows).not.toHaveBeenCalled();
  });
});

describe('usePlatformDealsScreenState — sucesso e isolamento por empresa', () => {
  it('companyId presente: mode deal_remote_active, fetchPlatformDealRows chamado com o companyId exato', async () => {
    mocks.fetchPlatformDealRows.mockResolvedValue([dealRow()]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformDealsScreenState('company-op-1'), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchPlatformDealRows).toHaveBeenCalledWith('company-op-1');
    expect(result.current.mode).toBe('deal_remote_active');
    expect(result.current.deals).toHaveLength(1);
    expect(result.current.deals[0].clientName).toBe('Carlos Andrade');
  });

  it('empresa A e empresa B nunca compartilham cache (query keys distintas)', async () => {
    mocks.fetchPlatformDealRows.mockImplementation((companyId: string) =>
      Promise.resolve([dealRow({ id: `deal-of-${companyId}`, company_id: companyId })]));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformDealsScreenState('company-a'), { wrapper });
    const { result: b } = renderHook(() => usePlatformDealsScreenState('company-b'), { wrapper });

    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.deals[0].id).toBe('deal-of-company-a');
    expect(b.current.deals[0].id).toBe('deal-of-company-b');
  });

  it('empty: isEmpty=true, hasData=false, deals=[]', async () => {
    mocks.fetchPlatformDealRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformDealsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformDealsScreenState — erro', () => {
  it('erro da query de Deals é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.fetchPlatformDealRows.mockRejectedValue(new Error('remote_deals_fetch_failed'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformDealsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformDealsScreenState — refetch', () => {
  it('expõe o refetch da query interna', async () => {
    mocks.fetchPlatformDealRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformDealsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(typeof result.current.refetch).toBe('function');
  });
});
