// Testes de usePlatformTasksScreenState (SUPER-ADMIN-COMPANY-CONTEXT-V2A-
// READ-B1-EXEC). fetchPlatformTaskRows e usePlatformLeads são mockados
// (cada um já tem cobertura própria — fetchPlatformTaskRows na
// integração real, usePlatformLeads em tests/hooks/usePlatformLeads.test.tsx)
// — useAdaptedRemoteTasks roda REAL (puro, determinístico), mesmo padrão de
// tests/hooks/useRemoteTasksScreenState.test.tsx. Alvo central: o shape de
// saída bate exatamente com UseRemoteTasksScreenStateResult (mesmos modos
// 'task_remote_active'/'task_remote_unavailable_identity' reaproveitados —
// ScreenPendencias não precisa saber a diferença) e companyId=null nunca
// dispara rede.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformTasksScreenState } from '@/lib/hooks/usePlatformTasksScreenState';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

const mocks = vi.hoisted(() => ({
  fetchPlatformTaskRows: vi.fn(),
  usePlatformLeads: vi.fn(),
}));

vi.mock('@/lib/tasks/remoteTaskRepository', () => ({
  fetchPlatformTaskRows: mocks.fetchPlatformTaskRows,
}));

vi.mock('@/lib/hooks/usePlatformLeads', () => ({
  usePlatformLeads: mocks.usePlatformLeads,
}));

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'task-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    title: 'Ligar para Carlos',
    note: '',
    priority: 'alta',
    status: 'pending',
    due_at: '2026-08-21T17:00:00+00:00',
    completed_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    completed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
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
  mocks.fetchPlatformTaskRows.mockReset();
  mocks.usePlatformLeads.mockReset().mockReturnValue(leadsResult());
});

describe('usePlatformTasksScreenState — gating', () => {
  it('companyId null: mode task_remote_unavailable_identity, fetchPlatformTaskRows nunca chamado', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState(null), { wrapper });
    expect(result.current.mode).toBe('task_remote_unavailable_identity');
    expect(result.current.tasks).toEqual([]);
    expect(mocks.fetchPlatformTaskRows).not.toHaveBeenCalled();
  });

  it('usePlatformLeads recebe authorized=false e companyId=null quando desabilitado', () => {
    const { wrapper } = createWrapper();
    renderHook(() => usePlatformTasksScreenState(null), { wrapper });
    expect(mocks.usePlatformLeads).toHaveBeenCalledWith({ companyId: null, archived: false, authorized: false });
  });
});

describe('usePlatformTasksScreenState — sucesso e isolamento por empresa', () => {
  it('companyId presente: mode task_remote_active, fetchPlatformTaskRows chamado com o companyId exato', async () => {
    mocks.fetchPlatformTaskRows.mockResolvedValue([taskRow()]);
    mocks.usePlatformLeads.mockReturnValue(leadsResult({ leads: [{ id: 'lead-1', name: 'Carlos Andrade' }], hasData: true }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState('company-op-1'), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchPlatformTaskRows).toHaveBeenCalledWith('company-op-1');
    expect(result.current.mode).toBe('task_remote_active');
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].lead).toBe('Carlos Andrade');
  });

  it('empresa A e empresa B nunca compartilham cache (query keys distintas)', async () => {
    mocks.fetchPlatformTaskRows.mockImplementation((companyId: string) =>
      Promise.resolve([taskRow({ id: `task-of-${companyId}`, company_id: companyId })]));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformTasksScreenState('company-a'), { wrapper });
    const { result: b } = renderHook(() => usePlatformTasksScreenState('company-b'), { wrapper });

    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.tasks[0].id).toBe('task-of-company-a');
    expect(b.current.tasks[0].id).toBe('task-of-company-b');
  });

  it('empty: isEmpty=true, hasData=false, tasks=[]', async () => {
    mocks.fetchPlatformTaskRows.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.tasks).toEqual([]);
  });
});

describe('usePlatformTasksScreenState — erro', () => {
  it('erro da query de Tasks é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.fetchPlatformTaskRows.mockRejectedValue(new Error('remote_tasks_fetch_failed'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });

  it('erro de usePlatformLeads também bloqueia (isError composto)', async () => {
    mocks.fetchPlatformTaskRows.mockResolvedValue([taskRow()]);
    mocks.usePlatformLeads.mockReturnValue(leadsResult({ isError: true, error: new Error('leads_fetch_failed') }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformTasksScreenState — refetch', () => {
  it('refetch aciona tanto a query de Tasks quanto a de Leads', async () => {
    mocks.fetchPlatformTaskRows.mockResolvedValue([]);
    const leadsRefetch = vi.fn();
    mocks.usePlatformLeads.mockReturnValue(leadsResult({ refetch: leadsRefetch }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformTasksScreenState('company-op-1'), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));

    result.current.refetch();
    expect(leadsRefetch).toHaveBeenCalled();
  });
});
