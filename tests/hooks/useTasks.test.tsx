// Testes de useTasks (COMMERCIAL-REMOTE-B1-B2-B1).
// Mock isolado de lib/supabase/client (cadeia from→select→eq→order→order)
// e mock controlável de resolveTaskRemoteMode. Nenhuma rede real, nenhum
// store, nenhuma dependência de Lead/Seller catalog.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTasks, type UseTasksOptions } from '@/lib/hooks/useTasks';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  resolveTaskRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

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

const MANAGER_OPTIONS: UseTasksOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager',
  userIsActive: true,
};

const SELLER_OPTIONS: UseTasksOptions = {
  ...MANAGER_OPTIONS,
  membershipRole: 'seller',
};

function mockTasksResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select });
  return { select, eq, order1, order2 };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

// ── A. Modo não remote_ready ─────────────────────────────────────────────

describe('useTasks — modos desabilitados (zero request)', () => {
  it.each([
    ['task_local', 'task_local'],
    ['task_blocked', 'task_blocked'],
    ['task_remote_misconfigured', 'task_remote_misconfigured'],
  ] as const)('mode=%s ⇒ queryEnabled=false, nenhuma chamada', (_label, mode) => {
    mocks.resolveTaskRemoteMode.mockReturnValue(mode);
    mockTasksResponse({ data: [taskRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

// ── B. remote_ready mas identidade incompleta ────────────────────────────

describe('useTasks — remote_ready com identidade incompleta (zero request)', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    mockTasksResponse({ data: [taskRow()], error: null });
  });

  it('sem userId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks({ ...MANAGER_OPTIONS, userId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId ⇒ nenhuma chamada, key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks({ ...MANAGER_OPTIONS, companyId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'tasks', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks({ ...MANAGER_OPTIONS, userIsActive: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller) ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useTasks({ ...MANAGER_OPTIONS, membershipRole: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

// ── C. remote_ready com identidade completa ──────────────────────────────

describe('useTasks — remote_ready com identidade completa', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('Manager: executa UMA leitura com a key da empresa', async () => {
    mockTasksResponse({ data: [taskRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(taskQueryKeys.active('company-a'));
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('Seller: também habilita a query', async () => {
    mockTasksResponse({ data: [taskRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(SELLER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    await waitFor(() => expect(result.current.hasData).toBe(true));
  });

  it('sucesso: rows CRUAS na ordem recebida, nenhuma adaptação', async () => {
    mockTasksResponse({
      data: [taskRow({ id: 'task-a' }), taskRow({ id: 'task-b', lead_id: null })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(['task-a', 'task-b']);
    expect(result.current.rows[0].due_at).toBe('2026-08-21T17:00:00+00:00');
    expect(result.current.rows[0]).not.toHaveProperty('state');
    expect(result.current.rows[0]).not.toHaveProperty('when');
  });

  it('lista vazia permanece vazia (isEmpty true, hasData false)', async () => {
    mockTasksResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    expect(result.current.rows).toEqual([]);
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('erro remoto é exposto sem fallback local', async () => {
    mockTasksResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect((result.current.error as { message?: string })?.message).toBe('remote_tasks_fetch_failed');
  });

  it('não escreve em localStorage durante a leitura remota', async () => {
    mockTasksResponse({ data: [taskRow()], error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('companies diferentes não compartilham cache', async () => {
    mockTasksResponse({ data: [taskRow()], error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => useTasks(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockTasksResponse({ data: [], error: null });
    const b = renderHook(() => useTasks({ ...MANAGER_OPTIONS, companyId: 'company-b' }), { wrapper });
    expect(b.result.current.queryKey).toEqual(taskQueryKeys.active('company-b'));
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    expect(a.result.current.rows).toHaveLength(1);
    expect(b.result.current.rows).toHaveLength(0);
    expect(queryClient.getQueryData(taskQueryKeys.active('company-a'))).not.toEqual(
      queryClient.getQueryData(taskQueryKeys.active('company-b')),
    );
  });
});
