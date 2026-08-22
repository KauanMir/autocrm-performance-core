// Testes de useRemoteSalesScreenState (COMMERCIAL-REMOTE-SALES-A2). useSales
// é mockado (já tem cobertura própria) — useAdaptedRemoteSales roda REAL
// (puro, determinístico) para que os testes de hard-gate/config-error/
// empty/data exercitem a adaptação de verdade, não um resultado forjado.
// Alvo central: o HARD GATE — nenhuma Sale cacheada pode vazar de um
// estado ativo anterior para local/blocked/misconfigured/
// unavailable-identity/loading/erro. Mesmo padrão de
// tests/hooks/useRemoteDealsScreenState.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteSalesScreenState } from '@/lib/hooks/useRemoteSalesScreenState';
import type { RemoteSaleRow } from '@/lib/sales/adapter';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  useSales: vi.fn(),
}));

vi.mock('@/lib/hooks/useSales', () => ({ useSales: mocks.useSales }));

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

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Gerente',
    email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function salesResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    saleRemoteMode: 'sale_local',
    queryEnabled: false,
    queryKey: [],
    rows: [] as readonly RemoteSaleRow[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    isEmpty: false,
    hasData: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.useSales.mockReset().mockReturnValue(salesResult());
});

describe('useRemoteSalesScreenState — mode', () => {
  it('sale_local → mode sale_local', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_local' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.mode).toBe('sale_local');
  });

  it('sale_blocked → mode sale_blocked', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_blocked' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.mode).toBe('sale_blocked');
  });

  it('sale_remote_misconfigured → mode sale_remote_misconfigured', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_misconfigured' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.mode).toBe('sale_remote_misconfigured');
  });

  it('sale_remote_ready + identidade inválida (sem membership) → sale_remote_unavailable_identity', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager({ activeMembership: null })));
    expect(result.current.mode).toBe('sale_remote_unavailable_identity');
  });

  it('sale_remote_ready + currentUser null → sale_remote_unavailable_identity', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(null));
    expect(result.current.mode).toBe('sale_remote_unavailable_identity');
  });

  it('sale_remote_ready + identidade válida (Manager) → sale_remote_active', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready' }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.mode).toBe('sale_remote_active');
  });

  it('sale_remote_ready + identidade válida (Seller) → sale_remote_active', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready' }));
    const seller = manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } });
    const { result } = renderHook(() => useRemoteSalesScreenState(seller));
    expect(result.current.mode).toBe('sale_remote_active');
  });
});

describe('useRemoteSalesScreenState — Rules of Hooks (sempre chamado)', () => {
  it('useSales é chamado mesmo em modo local', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_local' }));
    renderHook(() => useRemoteSalesScreenState(manager()));
    expect(mocks.useSales).toHaveBeenCalledTimes(1);
  });

  it('useSales é chamado mesmo sem identidade', () => {
    renderHook(() => useRemoteSalesScreenState(null));
    expect(mocks.useSales).toHaveBeenCalledTimes(1);
  });
});

describe('useRemoteSalesScreenState — hard gate em modos inativos (cached rows nunca vazam)', () => {
  it.each([
    ['sale_local', 'sale_local'],
    ['sale_blocked', 'sale_blocked'],
    ['sale_remote_misconfigured', 'sale_remote_misconfigured'],
  ] as const)('%s com rows cacheadas (hasData=true na query) → sales=[], hasData=false, isEmpty=false', (_label, saleRemoteMode) => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode, rows: [saleRow()], hasData: true, isEmpty: false }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.mode).toBe(saleRemoteMode);
    expect(result.current.sales).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it('sale_remote_unavailable_identity com rows cacheadas → sales=[], hasData=false', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready', rows: [saleRow()], hasData: true }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager({ activeMembership: null })));
    expect(result.current.mode).toBe('sale_remote_unavailable_identity');
    expect(result.current.sales).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('useRemoteSalesScreenState — active + loading inicial', () => {
  it('isLoading=true → sales=[], isEmpty=false, hasData=false, configError=null, mesmo com rows/hasData da query', () => {
    mocks.useSales.mockReturnValue(
      salesResult({ saleRemoteMode: 'sale_remote_ready', isLoading: true, rows: [saleRow()], hasData: true }),
    );
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.sales).toEqual([]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.configError).toBeNull();
  });
});

describe('useRemoteSalesScreenState — active + erro com stale cache (gate crítico)', () => {
  it('isError=true com rows antigas na query → sales=[], hasData=false, isEmpty=false, error preservado', () => {
    const queryError = { message: 'remote_sales_fetch_failed' };
    mocks.useSales.mockReturnValue(
      salesResult({ saleRemoteMode: 'sale_remote_ready', isError: true, error: queryError, rows: [saleRow()], hasData: true }),
    );
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(queryError);
    expect(result.current.sales).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

describe('useRemoteSalesScreenState — config error (dado inválido) distinto de query error', () => {
  it('query em sucesso, mas row inválida → configError preenchido, sales=[], hasData=false, isError=false', () => {
    mocks.useSales.mockReturnValue(
      salesResult({ saleRemoteMode: 'sale_remote_ready', isLoading: false, isError: false, rows: [saleRow({ sold_value_cents: 0 })], hasData: true }),
    );
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.configError).not.toBeNull();
    expect(result.current.configError?.code).toBe('invalid_sold_value');
    expect(result.current.sales).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

describe('useRemoteSalesScreenState — empty vs. data', () => {
  it('sucesso com rows=[] → isEmpty=true, hasData=false, sales=[]', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready', isLoading: false, isError: false, rows: [] }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.sales).toEqual([]);
  });

  it('sucesso com rows válidas → modelos retornados, hasData=true, isEmpty=false', () => {
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready', isLoading: false, isError: false, rows: [saleRow()] }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.sales).toHaveLength(1);
    expect(result.current.sales[0].id).toBe('sale-1');
  });
});

describe('useRemoteSalesScreenState — refetch e identidade repassada a useSales', () => {
  it('expõe o refetch da query interna', () => {
    const refetch = vi.fn();
    mocks.useSales.mockReturnValue(salesResult({ saleRemoteMode: 'sale_remote_ready', refetch }));
    const { result } = renderHook(() => useRemoteSalesScreenState(manager()));
    expect(result.current.refetch).toBe(refetch);
  });

  it('useSales recebe a identidade exata (userId/companyId/membershipRole/userIsActive)', () => {
    renderHook(() => useRemoteSalesScreenState(manager()));
    expect(mocks.useSales).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', companyId: 'company-a', membershipRole: 'manager', userIsActive: true }),
    );
  });
});
