// Testes de useRemoteTasksScreenState (COMMERCIAL-REMOTE-B1-B2-B3-B).
// useTasks e useRemoteLeadsScreenState são mockados (cada um já tem
// cobertura própria) — useAdaptedRemoteTasks roda REAL (puro,
// determinístico) para que os testes de hard-gate/config-error/empty/data
// exercitem a adaptação de verdade, não um resultado forjado. Alvo
// central desta suíte: o HARD GATE (§0) — nenhuma Task cacheada pode
// vazar de um estado ativo anterior para local/blocked/misconfigured/
// unavailable-identity/loading/erro, mesmo que a query mockada ainda
// reporte rows/hasData de um estado anterior.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteTasksScreenState } from '@/lib/hooks/useRemoteTasksScreenState';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  useTasks: vi.fn(),
  useRemoteLeadsScreenState: vi.fn(),
}));

vi.mock('@/lib/hooks/useTasks', () => ({ useTasks: mocks.useTasks }));
vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: mocks.useRemoteLeadsScreenState,
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

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Gerente',
    email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function tasksResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskRemoteMode: 'task_local',
    queryEnabled: false,
    queryKey: [],
    rows: [] as readonly RemoteTaskRow[],
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
  mocks.useTasks.mockReset().mockReturnValue(tasksResult());
  mocks.useRemoteLeadsScreenState.mockReset().mockReturnValue(leadsScreenStateResult());
});

// ── Resolução de mode (§18) ───────────────────────────────────────────────

describe('useRemoteTasksScreenState — mode', () => {
  it('task_local → mode task_local', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_local' }));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.mode).toBe('task_local');
  });

  it('task_blocked → mode task_blocked', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_blocked' }));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.mode).toBe('task_blocked');
  });

  it('task_remote_misconfigured → mode task_remote_misconfigured', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_misconfigured' }));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.mode).toBe('task_remote_misconfigured');
  });

  it('task_remote_ready + identidade inválida (sem membership) → task_remote_unavailable_identity', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_ready' }));
    const { result } = renderHook(
      () => useRemoteTasksScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('task_remote_unavailable_identity');
  });

  it('task_remote_ready + currentUser null → task_remote_unavailable_identity', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_ready' }));
    const { result } = renderHook(() => useRemoteTasksScreenState(null));
    expect(result.current.mode).toBe('task_remote_unavailable_identity');
  });

  it('task_remote_ready + identidade válida (Manager) → task_remote_active', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_ready' }));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.mode).toBe('task_remote_active');
  });

  it('task_remote_ready + identidade válida (Seller) → task_remote_active', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_ready' }));
    const seller = manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } });
    const { result } = renderHook(() => useRemoteTasksScreenState(seller));
    expect(result.current.mode).toBe('task_remote_active');
  });
});

describe('useRemoteTasksScreenState — Rules of Hooks (sempre chamados)', () => {
  it('useTasks e useRemoteLeadsScreenState são chamados mesmo em modo local', () => {
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_local' }));
    renderHook(() => useRemoteTasksScreenState(manager()));
    expect(mocks.useTasks).toHaveBeenCalledTimes(1);
    expect(mocks.useRemoteLeadsScreenState).toHaveBeenCalledTimes(1);
  });

  it('useTasks e useRemoteLeadsScreenState são chamados mesmo sem identidade', () => {
    renderHook(() => useRemoteTasksScreenState(null));
    expect(mocks.useTasks).toHaveBeenCalledTimes(1);
    expect(mocks.useRemoteLeadsScreenState).toHaveBeenCalledTimes(1);
  });
});

// ── §32-35: hard gate — nenhuma Task cacheada vaza fora de active ────────

describe('useRemoteTasksScreenState — hard gate em modos inativos (cached rows nunca vazam)', () => {
  it.each([
    ['task_local', 'task_local'],
    ['task_blocked', 'task_blocked'],
    ['task_remote_misconfigured', 'task_remote_misconfigured'],
  ] as const)('%s com rows cacheadas (hasData=true na query) → tasks=[], hasData=false, isEmpty=false', (_label, taskRemoteMode) => {
    mocks.useTasks.mockReturnValue(
      tasksResult({ taskRemoteMode, rows: [taskRow()], hasData: true, isEmpty: false }),
    );
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.mode).toBe(taskRemoteMode);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it('task_remote_unavailable_identity com rows cacheadas → tasks=[], hasData=false', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({ taskRemoteMode: 'task_remote_ready', rows: [taskRow()], hasData: true }),
    );
    const { result } = renderHook(
      () => useRemoteTasksScreenState(manager({ activeMembership: null })),
    );
    expect(result.current.mode).toBe('task_remote_unavailable_identity');
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

// ── §36: ACTIVE + initial loading ─────────────────────────────────────────

describe('useRemoteTasksScreenState — active + loading inicial (§36)', () => {
  it('isLoading=true → tasks=[], isEmpty=false, hasData=false, configError=null, mesmo com rows/hasData da query', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isLoading: true,
        rows: [taskRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.configError).toBeNull();
  });
});

// ── §37: ACTIVE + erro com cache obsoleto (gate crítico) ──────────────────

describe('useRemoteTasksScreenState — active + erro com stale cache (§37, gate crítico)', () => {
  it('isError=true com rows antigas na query → tasks=[], hasData=false, isEmpty=false, error preservado', () => {
    const queryError = { message: 'remote_tasks_fetch_failed' };
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isError: true,
        error: queryError,
        rows: [taskRow()],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(queryError);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});

// ── §38: background fetch preserva dados válidos ──────────────────────────

describe('useRemoteTasksScreenState — background fetch (§38)', () => {
  it('isFetching=true com sucesso prévio → Tasks continuam visíveis, hasData=true', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isLoading: false,
        isFetching: true,
        isError: false,
        rows: [taskRow()],
        hasData: true,
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.isFetching).toBe(true);
    expect(result.current.hasData).toBe(true);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].lead).toBe('Carlos Andrade');
  });
});

// ── §39: config error (dado inválido) distinto de query error ────────────

describe('useRemoteTasksScreenState — config error (§39)', () => {
  it('query em sucesso, mas row inválida → configError preenchido, tasks=[], hasData=false, isError=false', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isLoading: false,
        isError: false,
        rows: [taskRow({ due_at: 'nao-e-data' })],
        hasData: true,
      }),
    );
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.configError).not.toBeNull();
    expect(result.current.configError?.code).toBe('invalid_due_at');
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

// ── §40/§41: empty vs. data ────────────────────────────────────────────────

describe('useRemoteTasksScreenState — empty vs. data (§40/§41)', () => {
  it('sucesso com rows=[] → isEmpty=true, hasData=false, tasks=[]', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({ taskRemoteMode: 'task_remote_ready', isLoading: false, isError: false, rows: [] }),
    );
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.tasks).toEqual([]);
  });

  it('sucesso com rows válidas → modelos retornados, hasData=true, isEmpty=false', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isLoading: false,
        isError: false,
        rows: [taskRow()],
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe('task-1');
  });
});

// ── §44: troca de owner — nenhuma Task antiga exposta no novo estado ─────

describe('useRemoteTasksScreenState — troca de owner (§44)', () => {
  it('identidade fica inválida após troca; mesmo com a query mockada ainda expondo rows antigas, nenhuma Task vaza', () => {
    mocks.useTasks.mockReturnValue(
      tasksResult({
        taskRemoteMode: 'task_remote_ready',
        isLoading: false,
        isError: false,
        rows: [taskRow()],
        hasData: true,
      }),
    );
    mocks.useRemoteLeadsScreenState.mockReturnValue(leadsScreenStateResult(LEAD_1_CATALOG));

    const { result, rerender } = renderHook(
      ({ user }: { user: User | null }) => useRemoteTasksScreenState(user),
      { initialProps: { user: manager() } },
    );
    expect(result.current.mode).toBe('task_remote_active');
    expect(result.current.hasData).toBe(true);

    // Usuário perde a membership ativa (troca/expira) — a query mockada
    // continua "presa" no estado antigo (rows/hasData de antes), simulando
    // um cache que ainda não foi limpo.
    rerender({ user: manager({ activeMembership: null }) });

    expect(result.current.mode).toBe('task_remote_unavailable_identity');
    expect(result.current.tasks).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

// ── refetch/leadsById repassados corretamente ─────────────────────────────

describe('useRemoteTasksScreenState — refetch e identidade repassada a useTasks', () => {
  it('expõe o refetch da query interna', () => {
    const refetch = vi.fn();
    mocks.useTasks.mockReturnValue(tasksResult({ taskRemoteMode: 'task_remote_ready', refetch }));
    const { result } = renderHook(() => useRemoteTasksScreenState(manager()));
    expect(result.current.refetch).toBe(refetch);
  });

  it('useTasks recebe a identidade exata (userId/companyId/membershipRole/userIsActive)', () => {
    renderHook(() => useRemoteTasksScreenState(manager()));
    expect(mocks.useTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-a',
        membershipRole: 'manager',
        userIsActive: true,
      }),
    );
  });
});
