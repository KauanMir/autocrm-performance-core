// Testes de integração: mutation hook → invalidate → active query refetch
// → QueryCache update → Task bridge → RemoteTaskSnapshot
// (COMMERCIAL-REMOTE-B1-B2-C2-B). Único objetivo desta suíte: provar a
// cadeia REAL de infraestrutura, não a lógica de cada peça isoladamente
// (já coberta exaustivamente em tests/hooks/useTasks.test.tsx,
// tests/hooks/useCreateTask.test.tsx/useUpdateTask.test.tsx/
// useCompleteTask.test.tsx, tests/tasks/taskBridge.test.ts).
//
// Real: QueryClient, useTasks, useCreateTask/useUpdateTask/useCompleteTask,
// startTaskRemoteBridge, RemoteTaskSnapshot.
// Mockado: fetchPendingTaskRows/createRemoteTask/updateRemoteTask/
// completeRemoteTask (elimina qualquer chamada Supabase real) e
// resolveTaskRemoteMode (sempre 'task_remote_ready' — sem alterar env).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTasks } from '@/lib/hooks/useTasks';
import { useCreateTask, type CreateTaskCallInput } from '@/lib/hooks/useCreateTask';
import { useUpdateTask, type UpdateTaskCallInput } from '@/lib/hooks/useUpdateTask';
import { useCompleteTask, type CompleteTaskCallInput } from '@/lib/hooks/useCompleteTask';
import { startTaskRemoteBridge } from '@/lib/tasks/taskBridge';
import {
  clearAllRemoteTaskSnapshots,
  getRemoteTaskSnapshot,
} from '@/lib/tasks/remoteTaskSnapshot';
import { mapRemoteTasksMutationError } from '@/lib/tasks/errors';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

const mocks = vi.hoisted(() => ({
  fetchPendingTaskRows: vi.fn(),
  createRemoteTask: vi.fn(),
  updateRemoteTask: vi.fn(),
  completeRemoteTask: vi.fn(),
  resolveTaskRemoteMode: vi.fn(),
}));

vi.mock('@/lib/tasks/remoteTaskRepository', () => ({
  fetchPendingTaskRows: mocks.fetchPendingTaskRows,
}));

vi.mock('@/lib/tasks/remoteTaskMutationRepository', () => ({
  createRemoteTask: mocks.createRemoteTask,
  updateRemoteTask: mocks.updateRemoteTask,
  completeRemoteTask: mocks.completeRemoteTask,
}));

vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'task-a', company_id: 'company-a', lead_id: 'lead-1', assigned_seller_id: 's1',
    title: 'Ligar para Carlos', note: '', priority: 'alta', status: 'pending',
    due_at: '2026-08-21T17:00:00+00:00', completed_at: null, created_by: 'profile-1',
    updated_by: 'profile-1', completed_by: null, created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00', version: 1,
    ...overrides,
  };
}

const ROW_A = taskRow({ id: 'task-a' });
const ROW_B = taskRow({ id: 'task-b', title: 'Enviar proposta' });

const IDENTITY = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager' as const,
  userIsActive: true,
};

let activeCleanups: Array<() => void> = [];

function useIntegrationHarness() {
  return {
    tasksQuery: useTasks(IDENTITY),
    create: useCreateTask(IDENTITY),
    update: useUpdateTask(IDENTITY),
    complete: useCompleteTask(IDENTITY),
  };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useIntegrationHarness(), { wrapper });

  const stopBridge = startTaskRemoteBridge({
    queryClient,
    companyId: IDENTITY.companyId,
    identityKey: IDENTITY.userId,
    notify,
  });
  activeCleanups.push(stopBridge);

  return { queryClient, hook, notify };
}

beforeEach(() => {
  mocks.fetchPendingTaskRows.mockReset();
  mocks.createRemoteTask.mockReset();
  mocks.updateRemoteTask.mockReset();
  mocks.completeRemoteTask.mockReset();
  mocks.resolveTaskRemoteMode.mockReset().mockReturnValue('task_remote_ready');
});

afterEach(() => {
  activeCleanups.forEach((stop) => stop());
  activeCleanups = [];
  clearAllRemoteTaskSnapshots();
});

// ── Baseline: active observer real + bridge real ──────────────────────────

describe('integração — baseline (query ativa real + bridge real)', () => {
  it('após a primeira query resolver, RemoteTaskSnapshot reflete as rows iniciais', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]);
    const { hook } = setup();

    await waitFor(() => expect(hook.result.current.tasksQuery.hasData).toBe(true));
    expect(hook.result.current.tasksQuery.rows).toEqual([ROW_A]);

    await waitFor(() =>
      expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]),
    );
  });
});

// ── §6/§14/§15: create flow — invalidate → refetch real → bridge → snapshot ──

describe('integração — create (§6, §14 active-observer, §15 no-optimistic-flash)', () => {
  it('mutation não toca snapshot diretamente — só invalidate→refetch→bridge produz a atualização', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]);
    const { hook, notify } = setup();
    await waitFor(() => expect(hook.result.current.tasksQuery.hasData).toBe(true));
    await waitFor(() => expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]));

    // Refetch pós-invalidation controlado manualmente — permite inspecionar
    // o estado do snapshot ENQUANTO o refetch ainda está em voo (§15).
    let resolveRefetch: (rows: RemoteTaskRow[]) => void = () => {};
    mocks.fetchPendingTaskRows.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefetch = resolve; }),
    );
    mocks.createRemoteTask.mockResolvedValue(ROW_B);

    const createInput: CreateTaskCallInput = {
      actorRole: 'manager',
      assignedSellerId: 's1',
      title: 'Enviar proposta',
      priority: 'alta',
      dueAt: '2026-08-22T17:00:00+00:00',
    };
    const created = await hook.result.current.create.createTask(createInput);
    expect(created).toEqual(ROW_B);
    expect(mocks.createRemoteTask).toHaveBeenCalledTimes(1);

    // §14 ACTIVE OBSERVER ASSUMPTION — prova empírica: invalidateQueries
    // (chamado dentro do onSuccess do hook) já provocou uma SEGUNDA chamada
    // real a fetchPendingTaskRows, porque useTasks está montado como
    // observer ativo da MESMA key.
    await waitFor(() => expect(mocks.fetchPendingTaskRows).toHaveBeenCalledTimes(2));

    // §15 NO OPTIMISTIC FLASH — o refetch ainda não resolveu: o snapshot
    // PERMANECE no estado anterior, nunca mostra [ROW_A, ROW_B] antes da
    // resposta real do servidor.
    expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]);

    resolveRefetch([ROW_A, ROW_B]);

    // §13 QUERY→BRIDGE / §14 BRIDGE→SNAPSHOT: o resultado real do refetch
    // (fonte servidor, nunca um patch client-side) aparece no snapshot.
    await waitFor(() =>
      expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A, ROW_B]),
    );
    // §10 notify: disparou pelo menos uma vez após a transição real.
    expect(notify).toHaveBeenCalled();
  });
});

// ── §7: update flow ────────────────────────────────────────────────────────

describe('integração — update', () => {
  it('row antiga não permanece; snapshot final usa o retorno da query (servidor), nunca um patch client-side', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]);
    const { hook } = setup();
    await waitFor(() => expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]));

    const ROW_A2 = taskRow({ id: 'task-a', version: 2, due_at: '2026-08-23T10:00:00+00:00', title: 'Ligar de novo' });
    mocks.updateRemoteTask.mockResolvedValue(ROW_A2);
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A2]);

    const updateInput: UpdateTaskCallInput = {
      taskId: 'task-a', expectedVersion: 1, title: 'Ligar de novo', note: '',
      priority: 'alta', dueAt: '2026-08-23T10:00:00+00:00', assignedSellerId: 's1',
    };
    const result = await hook.result.current.update.updateTask(updateInput);
    expect(result).toEqual(ROW_A2);

    await waitFor(() =>
      expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A2]),
    );
    // Row antiga (due_at X, version 1) não sobrevive no snapshot final.
    const finalRows = getRemoteTaskSnapshot('company-a', 'user-1')?.rows ?? [];
    expect(finalRows.find((r) => r.version === 1)).toBeUndefined();
  });
});

// ── §8/§9: complete flow — GATE PRINCIPAL ─────────────────────────────────

describe('integração — complete (§8 gate principal, §9 empty-vs-absent obrigatório)', () => {
  it('Task concluída sai do pending: snapshot final é PRESENTE com rows=[], nunca ausente e nunca [A]', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]);
    const { hook } = setup();
    await waitFor(() => expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]));

    const ROW_A_COMPLETED = taskRow({
      id: 'task-a', status: 'completed', version: 2,
      completed_at: '2026-08-21T18:00:00+00:00', completed_by: 'profile-1',
    });
    mocks.completeRemoteTask.mockResolvedValue(ROW_A_COMPLETED);
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([]); // pending-only query já não a inclui

    const completeInput: CompleteTaskCallInput = { taskId: 'task-a', expectedVersion: 1 };
    await hook.result.current.complete.completeTask(completeInput);

    await waitFor(() => {
      const snapshot = getRemoteTaskSnapshot('company-a', 'user-1');
      expect(snapshot).not.toBeNull();
      expect(snapshot?.rows).toEqual([]);
    });

    // §9 — obrigatório: PRESENTE com rows vazio, nunca `null`/ausente.
    const finalSnapshot = getRemoteTaskSnapshot('company-a', 'user-1');
    expect(finalSnapshot).not.toBeNull();
    expect(finalSnapshot?.rows).toHaveLength(0);
  });
});

// ── §12: conflito realista — stale_write no update ────────────────────────

describe('integração — conflito stale_write (update)', () => {
  it('mutateAsync rejeita stale_write E o snapshot é atualizado com a versão real do servidor', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]); // version 1
    const { hook } = setup();
    await waitFor(() => expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]));

    mocks.updateRemoteTask.mockRejectedValue(
      mapRemoteTasksMutationError({ code: 'P0001', message: 'stale_write' }, 'update_task'),
    );
    const ROW_A_SERVER = taskRow({ id: 'task-a', version: 3, title: 'Alterada por outra pessoa' });
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A_SERVER]);

    const updateInput: UpdateTaskCallInput = {
      taskId: 'task-a', expectedVersion: 1, title: 'Minha edição', note: '',
      priority: 'alta', dueAt: '2026-08-21T17:00:00+00:00', assignedSellerId: 's1',
    };

    await expect(hook.result.current.update.updateTask(updateInput)).rejects.toMatchObject({
      code: 'remote_tasks_mutation_stale_write',
    });

    // O CRM se atualiza com a versão real do servidor — nunca com o
    // payload local que falhou, nunca fingindo sucesso.
    await waitFor(() =>
      expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A_SERVER]),
    );
  });
});

// ── §13: identity_changed não provoca refetch ─────────────────────────────

describe('integração — identity_changed não refetcha (§13)', () => {
  it('geração muda durante uma update em voo que REJEITA: identity_changed, e NENHUM refetch extra é provocado por essa mutation morta', async () => {
    mocks.fetchPendingTaskRows.mockResolvedValueOnce([ROW_A]);
    const { hook, queryClient } = setup();
    await waitFor(() => expect(getRemoteTaskSnapshot('company-a', 'user-1')?.rows).toEqual([ROW_A]));

    expect(mocks.fetchPendingTaskRows).toHaveBeenCalledTimes(1);

    let rejectUpdate: (error: unknown) => void = () => {};
    mocks.updateRemoteTask.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectUpdate = reject; }),
    );

    const updateInput: UpdateTaskCallInput = {
      taskId: 'task-a', expectedVersion: 1, title: 'X', note: '',
      priority: 'alta', dueAt: '2026-08-21T17:00:00+00:00', assignedSellerId: 's1',
    };
    const callPromise = hook.result.current.update.updateTask(updateInput);
    await waitFor(() => expect(mocks.updateRemoteTask).toHaveBeenCalled());

    bumpQueryCacheGeneration(queryClient); // simula troca de identidade em voo
    rejectUpdate(mapRemoteTasksMutationError({ message: 'stale_write' }, 'update_task'));

    await expect(callPromise).rejects.toMatchObject({ code: 'remote_tasks_mutation_identity_changed' });

    // Nenhuma invalidação/refetch provocada por esta mutation morta — a
    // contagem de fetchPendingTaskRows permanece exatamente a mesma do
    // baseline.
    expect(mocks.fetchPendingTaskRows).toHaveBeenCalledTimes(1);
  });
});
