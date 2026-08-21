// Testes de useRemoteDealsScreenState (COMMERCIAL-REMOTE-DEALS-B2-A).
// useDeals é mockado (já tem cobertura própria) — useAdaptedRemoteDeals roda
// REAL (puro, determinístico) para que os testes de hard-gate/config-error/
// empty/data exercitem a adaptação de verdade, não um resultado forjado.
// Diferente de tests/hooks/useRemoteVisitsScreenState.test.tsx: SEM
// useRemoteLeadsScreenState — o adapter de Deals não precisa de leadsById
// (client_name_snapshot já vem na row). Alvo central desta suíte: o HARD
// GATE — nenhuma Deal cacheada pode vazar de um estado ativo anterior para
// local/blocked/misconfigured/unavailable-identity/loading/erro.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteDealsScreenState } from '@/lib/hooks/useRemoteDealsScreenState';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  useDeals: vi.fn(),
}));

vi.mock('@/lib/hooks/useDeals', () => ({ useDeals: mocks.useDeals }));

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

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Gerente',
    email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function dealsResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dealRemoteMode: 'deal_local',
    queryEnabled: false,
    queryKey: [],
    rows: [] as readonly RemoteDealRow[],
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
  mocks.useDeals.mockReset().mockReturnValue(dealsResult());
});

describe('useRemoteDealsScreenState — mode', () => {
  it('deal_local → mode deal_local', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_local' }));
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.mode).toBe('deal_local');
  });

  it('deal_blocked → mode deal_blocked', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_blocked' }));
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.mode).toBe('deal_blocked');
  });

  it('deal_remote_misconfigured → mode deal_remote_misconfigured', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_misconfigured' }));
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.mode).toBe('deal_remote_misconfigured');
  });

  it('deal_remote_ready + identidade inválida (sem membership) → deal_remote_unavailable_identity', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_ready' }));
    const { result } = renderHook(
      () => useRemoteDealsScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('deal_remote_unavailable_identity');
  });

  it('deal_remote_ready + currentUser null → deal_remote_unavailable_identity', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_ready' }));
    const { result } = renderHook(() => useRemoteDealsScreenState(null));
    expect(result.current.mode).toBe('deal_remote_unavailable_identity');
  });

  it('deal_remote_ready + identidade válida (Manager) → deal_remote_active', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_ready' }));
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.mode).toBe('deal_remote_active');
  });

  it('deal_remote_ready + identidade válida (Seller) → deal_remote_active', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_ready' }));
    const seller = manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } });
    const { result } = renderHook(() => useRemoteDealsScreenState(seller));
    expect(result.current.mode).toBe('deal_remote_active');
  });
});

describe('useRemoteDealsScreenState — Rules of Hooks (sempre chamado)', () => {
  it('useDeals é chamado mesmo em modo local', () => {
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_local' }));
    renderHook(() => useRemoteDealsScreenState(manager()));
    expect(mocks.useDeals).toHaveBeenCalledTimes(1);
  });

  it('useDeals é chamado mesmo sem identidade', () => {
    renderHook(() => useRemoteDealsScreenState(null));
    expect(mocks.useDeals).toHaveBeenCalledTimes(1);
  });
});

describe('useRemoteDealsScreenState — hard gate em modos inativos (cached rows nunca vazam)', () => {
  it.each([
    ['deal_local', 'deal_local'],
    ['deal_blocked', 'deal_blocked'],
    ['deal_remote_misconfigured', 'deal_remote_misconfigured'],
  ] as const)('%s com rows cacheadas (hasData=true na query) → deals=[], hasData=false, isEmpty=false', (_label, dealRemoteMode) => {
    mocks.useDeals.mockReturnValue(
      dealsResult({ dealRemoteMode, rows: [dealRow()], hasData: true, isEmpty: false }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.mode).toBe(dealRemoteMode);
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it('deal_remote_unavailable_identity com rows cacheadas → deals=[], hasData=false', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({ dealRemoteMode: 'deal_remote_ready', rows: [dealRow()], hasData: true }),
    );
    const { result } = renderHook(
      () => useRemoteDealsScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('deal_remote_unavailable_identity');
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

describe('useRemoteDealsScreenState — active + loading inicial', () => {
  it('isLoading=true → deals=[], isEmpty=false, hasData=false, configError=null, mesmo com rows/hasData da query', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isLoading: true,
        rows: [dealRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.deals).toEqual([]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.configError).toBeNull();
  });
});

describe('useRemoteDealsScreenState — active + erro com stale cache (gate crítico)', () => {
  it('isError=true com rows antigas na query → deals=[], hasData=false, isEmpty=false, error preservado', () => {
    const queryError = { message: 'remote_deals_fetch_failed' };
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isError: true,
        error: queryError,
        rows: [dealRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(queryError);
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

describe('useRemoteDealsScreenState — background fetch', () => {
  it('isFetching=true com sucesso prévio → Deals continuam visíveis, hasData=true', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isLoading: false,
        isFetching: true,
        isError: false,
        rows: [dealRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.isFetching).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.deals).toHaveLength(1);
    expect(result.current.deals[0].clientName).toBe('Carlos Andrade');
  });
});

describe('useRemoteDealsScreenState — config error (dado inválido) distinto de query error', () => {
  it('query em sucesso, mas row inválida → configError preenchido, deals=[], hasData=false, isError=false', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isLoading: false,
        isError: false,
        rows: [dealRow({ vehicle: '' })],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.configError).not.toBeNull();
    expect(result.current.configError?.code).toBe('invalid_vehicle');
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

describe('useRemoteDealsScreenState — empty vs. data', () => {
  it('sucesso com rows=[] → isEmpty=true, hasData=false, deals=[]', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({ dealRemoteMode: 'deal_remote_ready', isLoading: false, isError: false, rows: [] }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.deals).toEqual([]);
  });

  it('sucesso com rows válidas → modelos retornados, hasData=true, isEmpty=false', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isLoading: false,
        isError: false,
        rows: [dealRow()],
      }),
    );
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.deals).toHaveLength(1);
    expect(result.current.deals[0].id).toBe('deal-1');
  });
});

describe('useRemoteDealsScreenState — troca de owner', () => {
  it('identidade fica inválida após troca; mesmo com a query mockada ainda expondo rows antigas, nenhuma Deal vaza', () => {
    mocks.useDeals.mockReturnValue(
      dealsResult({
        dealRemoteMode: 'deal_remote_ready',
        isLoading: false,
        isError: false,
        rows: [dealRow()],
        hasData: true,
      }),
    );

    const { result, rerender } = renderHook(
      ({ user }: { user: User | null }) => useRemoteDealsScreenState(user),
      { initialProps: { user: manager() } },
    );
    expect(result.current.mode).toBe('deal_remote_active');
    expect(result.current.hasData).toBe(true);

    rerender({ user: manager({ activeMembership: null }) });

    expect(result.current.mode).toBe('deal_remote_unavailable_identity');
    expect(result.current.deals).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('useRemoteDealsScreenState — refetch e identidade repassada a useDeals', () => {
  it('expõe o refetch da query interna', () => {
    const refetch = vi.fn();
    mocks.useDeals.mockReturnValue(dealsResult({ dealRemoteMode: 'deal_remote_ready', refetch }));
    const { result } = renderHook(() => useRemoteDealsScreenState(manager()));
    expect(result.current.refetch).toBe(refetch);
  });

  it('useDeals recebe a identidade exata (userId/companyId/membershipRole/userIsActive)', () => {
    renderHook(() => useRemoteDealsScreenState(manager()));
    expect(mocks.useDeals).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-a',
        membershipRole: 'manager',
        userIsActive: true,
      }),
    );
  });
});
