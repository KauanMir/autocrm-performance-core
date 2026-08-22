// Testes de useSales (COMMERCIAL-REMOTE-SALES-A2). Mock isolado de
// lib/supabase/client (cadeia from→select→order→order) e mock controlável
// de resolveSalesRemoteMode. Nenhuma rede real. Mesmo padrão de
// tests/hooks/useDeals.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSales, type UseSalesOptions } from '@/lib/hooks/useSales';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';
import type { RemoteSaleRow } from '@/lib/sales/adapter';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  resolveSalesRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/sales/remoteSalesMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sales/remoteSalesMode')>();
  return { ...actual, resolveSalesRemoteMode: mocks.resolveSalesRemoteMode };
});

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

const MANAGER_OPTIONS: UseSalesOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager',
  userIsActive: true,
};

const SELLER_OPTIONS: UseSalesOptions = { ...MANAGER_OPTIONS, membershipRole: 'seller' };

function mockSalesResponse(response: { data: unknown; error: unknown }) {
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
  mocks.resolveSalesRemoteMode.mockReturnValue('sale_local');
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe('useSales — modos desabilitados (zero request)', () => {
  it.each([
    ['sale_local', 'sale_local'],
    ['sale_blocked', 'sale_blocked'],
    ['sale_remote_misconfigured', 'sale_remote_misconfigured'],
  ] as const)('mode=%s ⇒ queryEnabled=false, nenhuma chamada', (_label, mode) => {
    mocks.resolveSalesRemoteMode.mockReturnValue(mode);
    mockSalesResponse({ data: [saleRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useSales — remote_ready com identidade incompleta (zero request)', () => {
  beforeEach(() => {
    mocks.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
    mockSalesResponse({ data: [saleRow()], error: null });
  });

  it('sem userId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales({ ...MANAGER_OPTIONS, userId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId ⇒ nenhuma chamada, key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales({ ...MANAGER_OPTIONS, companyId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'sales', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales({ ...MANAGER_OPTIONS, userIsActive: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller) ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales({ ...MANAGER_OPTIONS, membershipRole: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useSales — remote_ready com identidade completa', () => {
  beforeEach(() => {
    mocks.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it('Manager: executa UMA leitura com a key da empresa', async () => {
    mockSalesResponse({ data: [saleRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(salesQueryKeys.active('company-a'));
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('Seller: também habilita a query', async () => {
    mockSalesResponse({ data: [saleRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(SELLER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    await waitFor(() => expect(result.current.hasData).toBe(true));
  });

  it('sucesso: rows CRUAS na ordem recebida, nenhuma adaptação', async () => {
    mockSalesResponse({ data: [saleRow({ id: 'sale-a' }), saleRow({ id: 'sale-b' })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(['sale-a', 'sale-b']);
    expect(result.current.rows[0].sold_value_cents).toBe(11500000);
    expect(result.current.rows[0]).not.toHaveProperty('soldValueCents');
  });

  it('lista vazia permanece vazia (isEmpty true, hasData false)', async () => {
    mockSalesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    expect(result.current.rows).toEqual([]);
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('erro remoto é exposto sem fallback local', async () => {
    mockSalesResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect((result.current.error as { message?: string })?.message).toBe('remote_sales_fetch_failed');
  });

  it('companies diferentes não compartilham cache', async () => {
    mockSalesResponse({ data: [saleRow()], error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => useSales(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockSalesResponse({ data: [], error: null });
    const b = renderHook(() => useSales({ ...MANAGER_OPTIONS, companyId: 'company-b' }), { wrapper });
    expect(b.result.current.queryKey).toEqual(salesQueryKeys.active('company-b'));
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    expect(a.result.current.rows).toHaveLength(1);
    expect(b.result.current.rows).toHaveLength(0);
    expect(queryClient.getQueryData(salesQueryKeys.active('company-a'))).not.toEqual(
      queryClient.getQueryData(salesQueryKeys.active('company-b')),
    );
  });
});
