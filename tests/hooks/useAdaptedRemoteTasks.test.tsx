// Testes de useAdaptedRemoteTasks (COMMERCIAL-REMOTE-B1-B2-B3-B).
// deriveRemoteTasks/adaptRemoteTaskRows já têm cobertura exaustiva própria
// (tests/tasks/deriveRemoteTasks.test.ts, tests/tasks/taskAdapter.test.ts)
// — aqui o alvo é a COMPOSIÇÃO React: memoização por [rows, leadsById,
// dayKey], reatividade de Lead sem refetch, e o gate obrigatório de virada
// de dia (§43) via fake timers reais (vi.setSystemTime), sem `now`
// injetado — exercitando o caminho DEFAULT de useDayBoundaryKey.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdaptedRemoteTasks } from '@/lib/hooks/useAdaptedRemoteTasks';
import { isTaskAdapterError, type RemoteTaskRow, type TaskLeadRef } from '@/lib/tasks/taskAdapter';
import { TASK_STATE } from '@/lib/data';

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

const LEADS_BY_ID: Readonly<Record<string, TaskLeadRef>> = {
  'lead-1': { id: 'lead-1', name: 'Carlos Andrade' },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAdaptedRemoteTasks — adaptação', () => {
  it('adapta rows válidas via deriveRemoteTasks, sem duplicar lógica', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const rows = [taskRow()];
    const { result } = renderHook(() => useAdaptedRemoteTasks(rows, LEADS_BY_ID));
    expect(result.current.ok).toBe(true);
    if (!result.current.ok) return;
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].lead).toBe('Carlos Andrade');
  });

  it('lista vazia → {ok:true, tasks:[]}', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const { result } = renderHook(() => useAdaptedRemoteTasks([], LEADS_BY_ID));
    expect(result.current).toEqual({ ok: true, tasks: [] });
  });

  it('row inválida propaga o erro discriminado do adapter (config error)', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const rows = [taskRow({ due_at: 'nao-e-data' })];
    const { result } = renderHook(() => useAdaptedRemoteTasks(rows, LEADS_BY_ID));
    expect(result.current.ok).toBe(false);
    if (!isTaskAdapterError(result.current)) return;
    expect(result.current.code).toBe('invalid_due_at');
  });
});

describe('useAdaptedRemoteTasks — reatividade de Lead (sem refetch)', () => {
  it('mesma row, novo leadsById → nome real aparece no rerender, sem nenhum refetch/rede envolvida', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const rows = [taskRow({ lead_id: 'lead-fantasma' })];
    const { result, rerender } = renderHook(
      ({ leadsById }: { leadsById: Readonly<Record<string, TaskLeadRef>> }) =>
        useAdaptedRemoteTasks(rows, leadsById),
      { initialProps: { leadsById: {} as Readonly<Record<string, TaskLeadRef>> } },
    );
    expect(result.current.ok).toBe(true);
    if (result.current.ok) expect(result.current.tasks[0].lead).toBe('Cliente indisponível');

    rerender({ leadsById: { 'lead-fantasma': { id: 'lead-fantasma', name: 'Carlos Andrade' } } });

    expect(result.current.ok).toBe(true);
    if (result.current.ok) expect(result.current.tasks[0].lead).toBe('Carlos Andrade');
  });
});

// ── §43: gate obrigatório de virada de dia (via useDayBoundaryKey real) ──

describe('useAdaptedRemoteTasks — reatividade de virada de meia-noite (§43)', () => {
  it('mesmas rows, mesmo leadsById: TODAY vira LATE só pela passagem da meia-noite, sem refetch', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 0)); // falta 1 min p/ meia-noite
    const rows = [taskRow({ due_at: '2026-08-21T20:00:00Z' })];

    const { result } = renderHook(() => useAdaptedRemoteTasks(rows, LEADS_BY_ID));
    expect(result.current.ok).toBe(true);
    if (result.current.ok) expect(result.current.tasks[0].state).toBe(TASK_STATE.TODAY);

    act(() => {
      vi.setSystemTime(new Date(2026, 7, 22, 0, 0, 1));
      vi.advanceTimersByTime(60 * 1000); // dispara o timeout de virada do useDayBoundaryKey interno
    });

    // MESMO array de rows (nenhuma row alterada) — só o dayKey mudou.
    expect(result.current.ok).toBe(true);
    if (result.current.ok) expect(result.current.tasks[0].state).toBe(TASK_STATE.LATE);
  });
});

describe('useAdaptedRemoteTasks — memoização', () => {
  it('rows/leadsById com a mesma referência e sem virada de dia → mesma referência de resultado entre renders', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const rows = [taskRow()];
    const { result, rerender } = renderHook(() => useAdaptedRemoteTasks(rows, LEADS_BY_ID));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
