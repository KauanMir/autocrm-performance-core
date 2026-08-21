// Testes de useRemoteVisitsScreenState (COMMERCIAL-REMOTE-VISITS-B2-A).
// useVisits e useRemoteLeadsScreenState são mockados (cada um já tem
// cobertura própria) — useAdaptedRemoteVisits roda REAL (puro,
// determinístico) para que os testes de hard-gate/config-error/empty/data
// exercitem a adaptação de verdade, não um resultado forjado. Alvo
// central desta suíte: o HARD GATE — nenhuma Visit cacheada pode vazar de
// um estado ativo anterior para local/blocked/misconfigured/
// unavailable-identity/loading/erro, mesmo que a query mockada ainda
// reporte rows/hasData de um estado anterior. Mesmo padrão de
// tests/hooks/useRemoteTasksScreenState.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteVisitsScreenState } from '@/lib/hooks/useRemoteVisitsScreenState';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  useVisits: vi.fn(),
  useRemoteLeadsScreenState: vi.fn(),
}));

vi.mock('@/lib/hooks/useVisits', () => ({ useVisits: mocks.useVisits }));
vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: mocks.useRemoteLeadsScreenState,
}));

function visitRow(overrides: Partial<RemoteVisitRow> = {}): RemoteVisitRow {
  return {
    id: 'visit-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name: null,
    assigned_seller_id: 's1',
    vehicles: ['Golf GTI 2022'],
    scheduled_at: '2026-08-21T17:00:00+00:00',
    status: 'scheduled',
    outcome: null,
    note: '',
    result_note: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    closed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    closed_at: null,
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

function visitsResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    visitRemoteMode: 'visit_local',
    queryEnabled: false,
    queryKey: [],
    rows: [] as readonly RemoteVisitRow[],
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

function leadsScreenStateResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mode: 'remote_active',
    pipeline: {},
    sellerLabels: {},
    leads: { leads: [] as { id: string; name: string }[] },
    ...overrides,
  };
}

const LEAD_1_CATALOG = { leads: { leads: [{ id: 'lead-1', name: 'Carlos Andrade' }] } };

beforeEach(() => {
  mocks.useVisits.mockReset().mockReturnValue(visitsResult());
  mocks.useRemoteLeadsScreenState.mockReset().mockReturnValue(leadsScreenStateResult());
});

describe('useRemoteVisitsScreenState — mode', () => {
  it('visit_local → mode visit_local', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_local' }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.mode).toBe('visit_local');
  });

  it('visit_blocked → mode visit_blocked', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_blocked' }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.mode).toBe('visit_blocked');
  });

  it('visit_remote_misconfigured → mode visit_remote_misconfigured', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_misconfigured' }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.mode).toBe('visit_remote_misconfigured');
  });

  it('visit_remote_ready + identidade inválida (sem membership) → visit_remote_unavailable_identity', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_ready' }));
    const { result } = renderHook(
      () => useRemoteVisitsScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('visit_remote_unavailable_identity');
  });

  it('visit_remote_ready + currentUser null → visit_remote_unavailable_identity', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_ready' }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(null));
    expect(result.current.mode).toBe('visit_remote_unavailable_identity');
  });

  it('visit_remote_ready + identidade válida (Manager) → visit_remote_active', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_ready' }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.mode).toBe('visit_remote_active');
  });

  it('visit_remote_ready + identidade válida (Seller) → visit_remote_active', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_ready' }));
    const seller = manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } });
    const { result } = renderHook(() => useRemoteVisitsScreenState(seller));
    expect(result.current.mode).toBe('visit_remote_active');
  });
});

describe('useRemoteVisitsScreenState — Rules of Hooks (sempre chamados)', () => {
  it('useVisits e useRemoteLeadsScreenState são chamados mesmo em modo local', () => {
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_local' }));
    renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(mocks.useVisits).toHaveBeenCalledTimes(1);
    expect(mocks.useRemoteLeadsScreenState).toHaveBeenCalledTimes(1);
  });

  it('useVisits e useRemoteLeadsScreenState são chamados mesmo sem identidade', () => {
    renderHook(() => useRemoteVisitsScreenState(null));
    expect(mocks.useVisits).toHaveBeenCalledTimes(1);
    expect(mocks.useRemoteLeadsScreenState).toHaveBeenCalledTimes(1);
  });
});

describe('useRemoteVisitsScreenState — hard gate em modos inativos (cached rows nunca vazam)', () => {
  it.each([
    ['visit_local', 'visit_local'],
    ['visit_blocked', 'visit_blocked'],
    ['visit_remote_misconfigured', 'visit_remote_misconfigured'],
  ] as const)('%s com rows cacheadas (hasData=true na query) → visits=[], hasData=false, isEmpty=false', (_label, visitRemoteMode) => {
    mocks.useVisits.mockReturnValue(
      visitsResult({ visitRemoteMode, rows: [visitRow()], hasData: true, isEmpty: false }),
    );
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.mode).toBe(visitRemoteMode);
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it('visit_remote_unavailable_identity com rows cacheadas → visits=[], hasData=false', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({ visitRemoteMode: 'visit_remote_ready', rows: [visitRow()], hasData: true }),
    );
    const { result } = renderHook(
      () => useRemoteVisitsScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('visit_remote_unavailable_identity');
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

describe('useRemoteVisitsScreenState — active + loading inicial', () => {
  it('isLoading=true → visits=[], isEmpty=false, hasData=false, configError=null, mesmo com rows/hasData da query', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isLoading: true,
        rows: [visitRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.visits).toEqual([]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.configError).toBeNull();
  });
});

describe('useRemoteVisitsScreenState — active + erro com stale cache (gate crítico)', () => {
  it('isError=true com rows antigas na query → visits=[], hasData=false, isEmpty=false, error preservado', () => {
    const queryError = { message: 'remote_visits_fetch_failed' };
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isError: true,
        error: queryError,
        rows: [visitRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(queryError);
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

describe('useRemoteVisitsScreenState — background fetch', () => {
  it('isFetching=true com sucesso prévio → Visits continuam visíveis, hasData=true', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isLoading: false,
        isFetching: true,
        isError: false,
        rows: [visitRow()],
        hasData: true,
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.isFetching).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.visits).toHaveLength(1);
    expect(result.current.visits[0].clientName).toBe('Carlos Andrade');
  });
});

describe('useRemoteVisitsScreenState — config error (dado inválido) distinto de query error', () => {
  it('query em sucesso, mas row inválida → configError preenchido, visits=[], hasData=false, isError=false', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isLoading: false,
        isError: false,
        rows: [visitRow({ scheduled_at: 'nao-e-data' })],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.configError).not.toBeNull();
    expect(result.current.configError?.code).toBe('invalid_scheduled_at');
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

describe('useRemoteVisitsScreenState — empty vs. data', () => {
  it('sucesso com rows=[] → isEmpty=true, hasData=false, visits=[]', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({ visitRemoteMode: 'visit_remote_ready', isLoading: false, isError: false, rows: [] }),
    );
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.visits).toEqual([]);
  });

  it('sucesso com rows válidas → modelos retornados, hasData=true, isEmpty=false', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isLoading: false,
        isError: false,
        rows: [visitRow()],
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.visits).toHaveLength(1);
    expect(result.current.visits[0].id).toBe('visit-1');
  });
});

describe('useRemoteVisitsScreenState — troca de owner', () => {
  it('identidade fica inválida após troca; mesmo com a query mockada ainda expondo rows antigas, nenhuma Visit vaza', () => {
    mocks.useVisits.mockReturnValue(
      visitsResult({
        visitRemoteMode: 'visit_remote_ready',
        isLoading: false,
        isError: false,
        rows: [visitRow()],
        hasData: true,
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));

    const { result, rerender } = renderHook(
      ({ user }: { user: User | null }) => useRemoteVisitsScreenState(user),
      { initialProps: { user: manager() } },
    );
    expect(result.current.mode).toBe('visit_remote_active');
    expect(result.current.hasData).toBe(true);

    rerender({ user: manager({ activeMembership: null }) });

    expect(result.current.mode).toBe('visit_remote_unavailable_identity');
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('useRemoteVisitsScreenState — refetch e identidade repassada a useVisits', () => {
  it('expõe o refetch da query interna', () => {
    const refetch = vi.fn();
    mocks.useVisits.mockReturnValue(visitsResult({ visitRemoteMode: 'visit_remote_ready', refetch }));
    const { result } = renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(result.current.refetch).toBe(refetch);
  });

  it('useVisits recebe a identidade exata (userId/companyId/membershipRole/userIsActive)', () => {
    renderHook(() => useRemoteVisitsScreenState(manager()));
    expect(mocks.useVisits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-a',
        membershipRole: 'manager',
        userIsActive: true,
      }),
    );
  });
});
