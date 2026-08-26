// Testes de usePlatformVisitsScreenState (SUPER-ADMIN-COMPANY-CONTEXT-V2A-
// READ-B1-EXEC). Mesmo padrão exato de
// tests/hooks/usePlatformTasksScreenState.test.tsx: fetchPlatformVisitRows
// e usePlatformLeads mockados, useAdaptedRemoteVisits roda REAL.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformVisitsScreenState } from '@/lib/hooks/usePlatformVisitsScreenState';
import type { RemoteVisitRow } from '@/lib/visits/adapter';

const mocks = vi.hoisted(() => ({
  fetchPlatformVisitRows: vi.fn(),
  usePlatformLeads: vi.fn(),
}));

vi.mock('@/lib/visits/remoteRepository', () => ({
  fetchPlatformVisitRows: mocks.fetchPlatformVisitRows,
}));

vi.mock('@/lib/hooks/usePlatformLeads', () => ({
  usePlatformLeads: mocks.usePlatformLeads,
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

function leadsResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, leads: [] as { id: string; name: string }[],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
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
  mocks.fetchPlatformVisitRows.mockReset();
  mocks.usePlatformLeads.mockReset().mockReturnValue(leadsResult());
});

describe('usePlatformVisitsScreenState — gating', () => {
  it('companyId null: mode visit_remote_unavailable_identity, fetchPlatformVisitRows nunca chamado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformVisitsScreenState(null), { wrapper });
    expect(result.current.mode).toBe('visit_remote_unavailable_identity');
    expect(result.current.visits).toEqual([]);
    expect(mocks.fetchPlatformVisitRows).not.toHaveBeenCalled();
  });
});

describe('usePlatformVisitsScreenState — sucesso e isolamento por empresa', () => {
  it('companyId presente: mode visit_remote_active, fetchPlatformVisitRows chamado com o companyId exato', async () => {
    mocks.fetchPlatformVisitRows.mockResolvedValue([visitRow()]);
    mocks.usePlatformLeads.mockReturnValue(leadsResult({ leads: [{ id: 'lead-1', name: 'Carlos Andrade' }], hasData: true }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformVisitsScreenState('company-op-1'), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchPlatformVisitRows).toHaveBeenCalledWith('company-op-1');
    expect(result.current.mode).toBe('visit_remote_active');
    expect(result.current.visits).toHaveLength(1);
  });

  it('empresa A e empresa B nunca compartilham cache (query keys distintas)', async () => {
    mocks.fetchPlatformVisitRows.mockImplementation((companyId: string) =>
      Promise.resolve([visitRow({ id: `visit-of-${companyId}`, company_id: companyId })]));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformVisitsScreenState('company-a'), { wrapper });
    const { result: b } = renderHook(() => usePlatformVisitsScreenState('company-b'), { wrapper });

    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.visits[0].id).toBe('visit-of-company-a');
    expect(b.current.visits[0].id).toBe('visit-of-company-b');
  });

  it('empty: isEmpty=true, hasData=false, visits=[]', async () => {
    mocks.fetchPlatformVisitRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformVisitsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformVisitsScreenState — erro', () => {
  it('erro da query de Visits é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.fetchPlatformVisitRows.mockRejectedValue(new Error('remote_visits_fetch_failed'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformVisitsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.visits).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformVisitsScreenState — refetch', () => {
  it('refetch aciona tanto a query de Visits quanto a de Leads', async () => {
    mocks.fetchPlatformVisitRows.mockResolvedValue([]);
    const leadsRefetch = vi.fn();
    mocks.usePlatformLeads.mockReturnValue(leadsResult({ refetch: leadsRefetch }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformVisitsScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));

    result.current.refetch();
    expect(leadsRefetch).toHaveBeenCalled();
  });
});
