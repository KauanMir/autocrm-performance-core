// Testes do repositório remoto de Tasks (COMMERCIAL-REMOTE-B1-B2-B1).
// Mock isolado de lib/supabase/client (cadeia from→select→eq→order→order,
// com spies provando ausência de filtros de company/seller e de qualquer
// escrita/join). Nenhuma rede real, nenhum apontamento para o projeto
// remoto (ainda em 50 migrations, sem `tasks`).
import { describe, expect, it, vi } from 'vitest';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { fetchPendingTaskRows } from '@/lib/tasks/remoteTaskRepository';
import { isRemoteTasksError } from '@/lib/tasks/errors';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
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

type Spies = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order1: ReturnType<typeof vi.fn>;
  order2: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function mockTasksResponse(response: { data: unknown; error: unknown }): Spies {
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select, insert, update, delete: del, eq });
  return { select, eq, order1, order2, insert, update, del };
}

describe('fetchPendingTaskRows — forma exata da consulta', () => {
  it('from/select/eq/order exatos: pending, ordenação por due_at/id, sem filtro de company/seller', async () => {
    const spies = mockTasksResponse({ data: [taskRow()], error: null });
    const rows = await fetchPendingTaskRows();

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('tasks');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.eq).toHaveBeenCalledWith('status', 'pending');
    expect(spies.eq).toHaveBeenCalledTimes(1); // nenhum outro .eq (company_id, seller_id…) — RLS é a autoridade
    expect(spies.order1).toHaveBeenCalledWith('due_at', { ascending: true });
    expect(spies.order2).toHaveBeenCalledWith('id', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('nenhuma RPC, nenhuma escrita, nenhum join de Lead/Seller', async () => {
    const spies = mockTasksResponse({ data: [], error: null });
    await fetchPendingTaskRows();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
    // select('*') nunca com hint de relação embutida (ex.: 'lead:leads(name)').
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.select).not.toHaveBeenCalledWith(expect.stringContaining(':'));
  });

  it('retorno tipado preserva ordem e conteúdo — rows CRUAS, nenhuma adaptação', async () => {
    const a = taskRow({ id: 'task-a', due_at: '2026-08-21T10:00:00+00:00' });
    const b = taskRow({ id: 'task-b', due_at: '2026-08-22T10:00:00+00:00' });
    mockTasksResponse({ data: [a, b], error: null });
    const rows = await fetchPendingTaskRows();
    expect(rows.map((r) => r.id)).toEqual(['task-a', 'task-b']);
    // Nenhum campo de RemoteTaskModel (state/when/lead/prio) aparece — só
    // as colunas cruas do banco.
    expect(rows[0]).not.toHaveProperty('state');
    expect(rows[0]).not.toHaveProperty('when');
    expect(rows[0].due_at).toBe('2026-08-21T10:00:00+00:00');
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockTasksResponse({ data: null, error: null });
    await expect(fetchPendingTaskRows()).resolves.toEqual([]);
  });
});

describe('fetchPendingTaskRows — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_tasks_fetch_failed', async () => {
    mockTasksResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchPendingTaskRows();
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteTasksError(e) && e.code === 'remote_tasks_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query; raw Postgres nunca é a mensagem do erro', async () => {
    mockTasksResponse({
      data: null,
      error: { message: 'permission denied', code: '42501', apikey: 'nunca-copiar', details: 'interno' },
    });
    const error = await fetchPendingTaskRows().catch((e) => e);
    expect(isRemoteTasksError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('remote_tasks_fetch_failed');
  });
});
