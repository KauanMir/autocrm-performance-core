// Testes de lib/tasks/remoteTaskMutationRepository.ts
// (COMMERCIAL-REMOTE-B1-B2-C1). Supabase mockado (rpc), nenhuma rede real,
// nenhuma migration remota envolvida. Prova: create/update/complete chamam
// a RPC certa com EXATAMENTE os argumentos do contrato real (migration
// #51), nunca p_company_id/status/version/actor*; update_task é FULL
// REPLACE (payload parcial falha em compile-time, §22); retorno é sempre
// RemoteTaskRow cru (sem state/when/lead name); erros do backend viram
// RemoteTasksError via mapRemoteTasksMutationError; data=null sem erro é
// tratado como erro controlado, nunca `undefined as RemoteTaskRow`.
import { describe, expect, it, vi } from 'vitest';
import {
  createRemoteTask,
  updateRemoteTask,
  completeRemoteTask,
  type UpdateRemoteTaskPayload,
} from '@/lib/tasks/remoteTaskMutationRepository';
import { isRemoteTasksError } from '@/lib/tasks/errors';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
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

// ── createRemoteTask ────────────────────────────────────────────────────

describe('createRemoteTask', () => {
  it('§18: chama create_task com EXATAMENTE os 6 argumentos do contrato, nenhum extra', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow(), error: null });
    await createRemoteTask({
      title: 'Ligar para Carlos',
      priority: 'alta',
      dueAt: '2026-08-21T17:00:00+00:00',
      assignedSellerId: 's1',
      leadId: 'lead-1',
      note: 'Retornar após o almoço',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('create_task', {
      p_title: 'Ligar para Carlos',
      p_priority: 'alta',
      p_due_at: '2026-08-21T17:00:00+00:00',
      p_assigned_seller_id: 's1',
      p_lead_id: 'lead-1',
      p_note: 'Retornar após o almoço',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(6);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('version');
  });

  it('§19: leadId null → p_lead_id null', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow({ lead_id: null }), error: null });
    await createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z', leadId: null });
    expect(mocks.rpc.mock.calls[0][1].p_lead_id).toBeNull();
  });

  it('§20: note mapeado para p_note, nunca confundido com title', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow(), error: null });
    await createRemoteTask({ title: 'Título real', priority: 'media', dueAt: '2026-08-21T17:00:00Z', note: 'Nota real' });
    expect(mocks.rpc.mock.calls[0][1].p_title).toBe('Título real');
    expect(mocks.rpc.mock.calls[0][1].p_note).toBe('Nota real');
  });

  it('campos opcionais omitidos → assigned_seller_id/lead_id null, note vazia (espelha os defaults do SQL)', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow(), error: null });
    await createRemoteTask({ title: 'X', priority: 'baixa', dueAt: '2026-08-21T17:00:00Z' });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_assigned_seller_id: null,
      p_lead_id: null,
      p_note: '',
    });
  });

  it('§24: retorna a RemoteTaskRow crua recebida da RPC — nenhum state/when/lead name criado aqui', async () => {
    const row = taskRow({ id: 'task-novo' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z' });
    expect(result).toEqual(row);
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('when');
    expect(result).not.toHaveProperty('lead');
  });

  it.each([
    ['seller_required', 'remote_tasks_mutation_seller_required'],
    ['seller_not_found', 'remote_tasks_mutation_seller_not_found'],
    ['lead_not_found', 'remote_tasks_mutation_lead_not_found'],
    ['invalid_title', 'remote_tasks_mutation_invalid_title'],
    ['forbidden', 'remote_tasks_mutation_forbidden'],
  ] as const)('§25: erro %s do backend vira RemoteTasksError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z' });
    await expect(failure).rejects.toSatisfy((e: unknown) => isRemoteTasksError(e));
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('§26: mensagem de erro desconhecida → generic_error controlado, nunca texto cru do Postgres exposto', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "tasks_pkey"' },
    });
    const failure = createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z' });
    await expect(failure).rejects.toMatchObject({ code: 'remote_tasks_mutation_generic_error' });
  });

  it('§27: data=null sem erro é anômalo → erro controlado, nunca `undefined as RemoteTaskRow`', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z' }))
      .rejects.toMatchObject({ code: 'remote_tasks_mutation_generic_error' });
  });

  it('§28: não escreve em localStorage durante a mutation', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow(), error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await createRemoteTask({ title: 'X', priority: 'alta', dueAt: '2026-08-21T17:00:00Z' });
    expect(setItem).not.toHaveBeenCalled();
  });
});

// ── updateRemoteTask ────────────────────────────────────────────────────

describe('updateRemoteTask', () => {
  it('§21: chama update_task com EXATAMENTE os 7 argumentos do full-replace', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow({ version: 2 }), error: null });
    await updateRemoteTask({
      taskId: 'task-1',
      expectedVersion: 1,
      title: 'Título atualizado',
      note: 'Nota atualizada',
      priority: 'media',
      dueAt: '2026-08-22T18:00:00Z',
      assignedSellerId: 's2',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('update_task', {
      p_id: 'task-1',
      p_expected_version: 1,
      p_title: 'Título atualizado',
      p_note: 'Nota atualizada',
      p_priority: 'media',
      p_due_at: '2026-08-22T18:00:00Z',
      p_assigned_seller_id: 's2',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(7);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_lead_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_status');
  });

  it('§22/§9: FULL-REPLACE type safety — um payload parcial (só taskId/expectedVersion/dueAt) é inválido em tempo de compilação', () => {
    mocks.rpc.mockResolvedValue({ data: taskRow(), error: null });
    // @ts-expect-error — update_task é FULL REPLACE (precheck §7/§9):
    // title/note/priority/assignedSellerId são obrigatórios no payload.
    // Um "reagendamento" que só envie taskId/expectedVersion/dueAt (como
    // uma futura chamada ingênua de updateRemoteTask({taskId, dueAt}))
    // precisa falhar aqui, nunca apagar os demais campos em silêncio.
    const invalidPayload: UpdateRemoteTaskPayload = {
      taskId: 'task-1',
      expectedVersion: 1,
      dueAt: '2026-08-22T18:00:00Z',
    };
    // Nunca executado de propósito — o objetivo é o erro de compilação
    // acima, não um comportamento em runtime.
    expect(typeof invalidPayload).toBe('object');
  });

  it.each([
    ['task_not_found', 'remote_tasks_mutation_task_not_found'],
    ['task_completed', 'remote_tasks_mutation_task_completed'],
    ['stale_write', 'remote_tasks_mutation_stale_write'],
    ['seller_required', 'remote_tasks_mutation_seller_required'],
    ['seller_not_found', 'remote_tasks_mutation_seller_not_found'],
    ['invalid_title', 'remote_tasks_mutation_invalid_title'],
    ['forbidden', 'remote_tasks_mutation_forbidden'],
  ] as const)('§25: erro %s do backend vira RemoteTasksError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = updateRemoteTask({
      taskId: 'task-1',
      expectedVersion: 1,
      title: 'X',
      note: '',
      priority: 'alta',
      dueAt: '2026-08-22T18:00:00Z',
      assignedSellerId: 's1',
    });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('§15: stale_write nunca é reenviado automaticamente — repository só propaga o erro mapeado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(
      updateRemoteTask({
        taskId: 'task-1', expectedVersion: 1, title: 'X', note: '', priority: 'alta',
        dueAt: '2026-08-22T18:00:00Z', assignedSellerId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'remote_tasks_mutation_stale_write' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); // nenhuma segunda chamada/retry automático
  });

  it('§24: retorna a RemoteTaskRow crua (version já incrementada pelo trigger, sem reformatação)', async () => {
    const row = taskRow({ version: 2, due_at: '2026-08-22T18:00:00Z' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await updateRemoteTask({
      taskId: 'task-1', expectedVersion: 1, title: 'X', note: '', priority: 'alta',
      dueAt: '2026-08-22T18:00:00Z', assignedSellerId: 's1',
    });
    expect(result).toEqual(row);
  });

  it('§27: data=null sem erro → erro controlado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      updateRemoteTask({
        taskId: 'task-1', expectedVersion: 1, title: 'X', note: '', priority: 'alta',
        dueAt: '2026-08-22T18:00:00Z', assignedSellerId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'remote_tasks_mutation_generic_error' });
  });
});

// ── completeRemoteTask ──────────────────────────────────────────────────

describe('completeRemoteTask', () => {
  it('§23: chama complete_task com SOMENTE p_id/p_expected_version', async () => {
    mocks.rpc.mockResolvedValue({ data: taskRow({ status: 'completed', completed_at: '2026-08-21T18:00:00Z', completed_by: 'profile-1' }), error: null });
    await completeRemoteTask({ taskId: 'task-1', expectedVersion: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('complete_task', {
      p_id: 'task-1',
      p_expected_version: 1,
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(2);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_completed_at');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_completed_by');
  });

  it.each([
    ['already_completed', 'remote_tasks_mutation_already_completed'],
    ['task_not_found', 'remote_tasks_mutation_task_not_found'],
    ['stale_write', 'remote_tasks_mutation_stale_write'],
    ['forbidden', 'remote_tasks_mutation_forbidden'],
  ] as const)('§25: erro %s do backend vira RemoteTasksError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = completeRemoteTask({ taskId: 'task-1', expectedVersion: 1 });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('§24: retorna a RemoteTaskRow crua já concluída pelo banco (status/completed_at/completed_by resolvidos pelo backend)', async () => {
    const row = taskRow({ status: 'completed', completed_at: '2026-08-21T18:00:00Z', completed_by: 'profile-1' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await completeRemoteTask({ taskId: 'task-1', expectedVersion: 1 });
    expect(result).toEqual(row);
  });

  it('§27: data=null sem erro → erro controlado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeRemoteTask({ taskId: 'task-1', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'remote_tasks_mutation_generic_error' });
  });
});
