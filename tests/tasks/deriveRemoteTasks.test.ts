// Testes de lib/tasks/deriveRemoteTasks.ts (COMMERCIAL-REMOTE-B1-B2-B3-A).
// Puro — nenhum mock necessário (adaptRemoteTaskRows já testado
// exaustivamente em tests/tasks/taskAdapter.test.ts; aqui cobrimos que o
// wrapper repassa rows/leadsById/now corretamente, sem duplicar lógica).
import { describe, expect, it } from 'vitest';
import { deriveRemoteTasks } from '@/lib/tasks/deriveRemoteTasks';
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

const NOW = new Date(2026, 7, 21, 15, 0); // 21/08/2026 15:00, local

describe('deriveRemoteTasks — rows válidas', () => {
  it('adapta rows preservando id/title/lead/version/dueAt', () => {
    const result = deriveRemoteTasks([taskRow()], LEADS_BY_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-1');
    expect(result.tasks[0].lead).toBe('Carlos Andrade');
    expect(result.tasks[0].version).toBe(1);
    expect(result.tasks[0].dueAt).toBe('2026-08-21T17:00:00+00:00');
  });

  it('lead_id null → lead vazio', () => {
    const result = deriveRemoteTasks([taskRow({ lead_id: null })], LEADS_BY_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].leadId).toBeNull();
    expect(result.tasks[0].lead).toBe('');
  });

  it('Lead ausente de leadsById → placeholder "Cliente indisponível", nunca erro', () => {
    const result = deriveRemoteTasks([taskRow({ lead_id: 'lead-fantasma' })], LEADS_BY_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].lead).toBe('Cliente indisponível');
  });

  it('leadsById vazio ({}) nunca lança — apenas produz placeholders', () => {
    const result = deriveRemoteTasks([taskRow()], {}, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].lead).toBe('Cliente indisponível');
  });
});

describe('deriveRemoteTasks — ausência de dependência de Seller', () => {
  it('assigned_seller_id mapeado direto para assignedTo, sem qualquer catálogo de Seller', () => {
    const result = deriveRemoteTasks([taskRow({ assigned_seller_id: 's-desconhecido' })], LEADS_BY_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks[0].assignedTo).toBe('s-desconhecido');
  });
});

describe('deriveRemoteTasks — vazio e ordenação', () => {
  it('lista vazia → resultado de sucesso com tasks:[] (EMPTY é válido, nunca erro)', () => {
    const result = deriveRemoteTasks([], LEADS_BY_ID, NOW);
    expect(result).toEqual({ ok: true, tasks: [] });
  });

  it('preserva a ordem exata de entrada (due_at ASC, id ASC já vem da query — nenhum novo sort)', () => {
    const rows = [
      taskRow({ id: 'task-b', due_at: '2026-08-22T10:00:00Z' }),
      taskRow({ id: 'task-a', due_at: '2026-08-21T10:00:00Z' }),
    ];
    const result = deriveRemoteTasks(rows, LEADS_BY_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ordem de ENTRADA preservada mesmo estando "fora de ordem" por
    // due_at — a função nunca reordena.
    expect(result.tasks.map((t) => t.id)).toEqual(['task-b', 'task-a']);
  });
});

describe('deriveRemoteTasks — propagação de erro do adapter', () => {
  it('row inválida (due_at não-parseável) propaga o erro discriminado, nunca pula/inventa', () => {
    const result = deriveRemoteTasks([taskRow({ due_at: 'nao-e-data' })], LEADS_BY_ID, NOW);
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.code).toBe('invalid_due_at');
  });

  it('falha no PRIMEIRO registro inválido de um lote com múltiplas rows — nenhum resultado parcial', () => {
    const rows = [taskRow({ id: 'task-ok' }), taskRow({ id: 'task-ruim', version: 0 })];
    const result = deriveRemoteTasks(rows, LEADS_BY_ID, NOW);
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.taskId).toBe('task-ruim');
    expect(result.rowIndex).toBe(1);
  });
});

describe('deriveRemoteTasks — same-now', () => {
  it('usa o MESMO now para state e when de todas as rows do lote', () => {
    const almostMidnight = new Date(2026, 7, 21, 23, 59, 59);
    const rows = [
      taskRow({ id: 'task-a', due_at: '2026-08-21T10:00:00Z' }),
      taskRow({ id: 'task-b', due_at: '2026-08-21T20:00:00Z' }),
    ];
    const result = deriveRemoteTasks(rows, LEADS_BY_ID, almostMidnight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ambas ainda no mesmo dia local de `almostMidnight` → TODAY as duas,
    // nunca uma TODAY e outra LATE por terem usado instantes diferentes.
    expect(result.tasks[0].state).toBe(TASK_STATE.TODAY);
    expect(result.tasks[1].state).toBe(TASK_STATE.TODAY);
  });

  it('default de now é o relógio real quando omitido', () => {
    const result = deriveRemoteTasks([taskRow({ due_at: new Date().toISOString() })], LEADS_BY_ID);
    expect(result.ok).toBe(true);
  });
});

// ── §21: gate obrigatório TODAY → LATE na virada do dia ──────────────────

describe('deriveRemoteTasks — virada de dia (mesma raw row, novo now)', () => {
  it('a MESMA RemoteTaskRow, sem nenhuma alteração, muda de TODAY para LATE só por causa de um `now` mais tardio', () => {
    const row = taskRow({ due_at: '2026-08-21T20:00:00Z' }); // pending, vence "hoje" (21/08)
    const beforeMidnight = new Date(2026, 7, 21, 23, 59, 59);
    const afterMidnight = new Date(2026, 7, 22, 0, 0, 1);

    const before = deriveRemoteTasks([row], LEADS_BY_ID, beforeMidnight);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.tasks[0].state).toBe(TASK_STATE.TODAY);

    // Mesmíssima row (nenhum campo alterado) — só o `now` passado muda.
    const after = deriveRemoteTasks([row], LEADS_BY_ID, afterMidnight);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.tasks[0].state).toBe(TASK_STATE.LATE);
  });
});
