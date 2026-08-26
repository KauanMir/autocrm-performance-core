// Testes de usePlatformSalesScreenState (SUPER-ADMIN-COMPANY-CONTEXT-V2B-
// READ-B1-EXEC). Mesmo padrão de tests/hooks/usePlatformDealsScreenState.test.tsx
// — fetchPlatformSaleRows mockado, useAdaptedRemoteSales roda REAL (puro).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformSalesScreenState } from '@/lib/hooks/usePlatformSalesScreenState';
import type { RemoteSaleRow } from '@/lib/sales/adapter';

const mocks = vi.hoisted(() => ({
  fetchPlatformSaleRows: vi.fn(),
}));

vi.mock('@/lib/sales/remoteRepository', () => ({
  fetchPlatformSaleRows: mocks.fetchPlatformSaleRows,
}));

function saleRow(overrides: Partial<RemoteSaleRow> = {}): RemoteSaleRow {
  return {
    id: 'sale-1',
    company_id: 'company-a',
    deal_id: 'deal-1',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    sold_value_cents: 11500000,
    payment_method: 'a_vista',
    sold_by: 'profile-1',
    sold_at: '2026-08-22T10:00:00+00:00',
    created_at: '2026-08-22T10:00:00+00:00',
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
  mocks.fetchPlatformSaleRows.mockReset();
});

describe('usePlatformSalesScreenState — gating', () => {
  it('companyId null: mode sale_remote_unavailable_identity, fetchPlatformSaleRows nunca chamado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSalesScreenState(null), { wrapper });
    expect(result.current.mode).toBe('sale_remote_unavailable_identity');
    expect(result.current.sales).toEqual([]);
    expect(mocks.fetchPlatformSaleRows).not.toHaveBeenCalled();
  });
});

describe('usePlatformSalesScreenState — sucesso e isolamento por empresa (§32 money safety)', () => {
  it('companyId presente: mode sale_remote_active, fetchPlatformSaleRows chamado com o companyId exato', async () => {
    mocks.fetchPlatformSaleRows.mockResolvedValue([saleRow()]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSalesScreenState('company-op-1'), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchPlatformSaleRows).toHaveBeenCalledWith('company-op-1');
    expect(result.current.mode).toBe('sale_remote_active');
    expect(result.current.sales).toHaveLength(1);
    expect(result.current.sales[0].soldValueCents).toBe(11500000);
  });

  it('empresa A e empresa B nunca compartilham cache nem valor financeiro (fixtures propositalmente distintos)', async () => {
    mocks.fetchPlatformSaleRows.mockImplementation((companyId: string) =>
      Promise.resolve([saleRow({
        id: `sale-of-${companyId}`, company_id: companyId,
        sold_value_cents: companyId === 'company-a' ? 123456 : 987654,
      })]));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformSalesScreenState('company-a'), { wrapper });
    const { result: b } = renderHook(() => usePlatformSalesScreenState('company-b'), { wrapper });

    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.sales[0].id).toBe('sale-of-company-a');
    expect(a.current.sales[0].soldValueCents).toBe(123456);
    expect(b.current.sales[0].id).toBe('sale-of-company-b');
    expect(b.current.sales[0].soldValueCents).toBe(987654);
    expect(a.current.sales[0].soldValueCents).not.toBe(b.current.sales[0].soldValueCents);
  });

  it('empty: isEmpty=true, hasData=false, sales=[]', async () => {
    mocks.fetchPlatformSaleRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSalesScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformSalesScreenState — erro', () => {
  it('erro da query de Sales é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.fetchPlatformSaleRows.mockRejectedValue(new Error('remote_sales_fetch_failed'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSalesScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.sales).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformSalesScreenState — refetch', () => {
  it('expõe o refetch da query interna', async () => {
    mocks.fetchPlatformSaleRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSalesScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(typeof result.current.refetch).toBe('function');
  });
});
