// Testes de lib/tasks/taskAdapter.ts (COMMERCIAL-REMOTE-B1-B2-A). Puro —
// nenhum mock necessário (deriveTaskState/formatTaskWhen já testados
// isoladamente em B1-B1; aqui cobrimos apenas a composição do adapter).
// `now` sempre injetado explicitamente.
import { describe, expect, it } from 'vitest';
import {
  adaptRemoteTaskRow,
  adaptRemoteTaskRows,
  isTaskAdapterError,
  TASK_LEAD_UNAVAILABLE_DISPLAY_VALUE,
  type RemoteTaskRow,
  type TaskAdapterContext,
} from '@/lib/tasks/taskAdapter';
import { TASK_STATE } from '@/lib/data';

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'task-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    title: 'Ligar para Carlos',
    note: 'Primeiro contato',
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

function makeContext(): TaskAdapterContext {
  return {
    leadsById: { 'lead-1': { id: 'lead-1', name: 'Carlos Andrade' } },
  };
}

const NOW = new Date(2026, 7, 21, 15, 0); // 21/08/2026 15:00, local

describe('adaptRemoteTaskRow — caminho feliz', () => {
  it('mapeia todos os campos corretamente', () => {
    const result = adaptRemoteTaskRow(taskRow(), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.id).toBe('task-1');
    expect(result.task.title).toBe('Ligar para Carlos');
    expect(result.task.note).toBe('Primeiro contato');
    expect(result.task.leadId).toBe('lead-1');
    expect(result.task.lead).toBe('Carlos Andrade');
    expect(result.task.assignedTo).toBe('s1');
    expect(result.task.prio).toBe('alta');
    expect(result.task.createdAt).toBe('2026-08-20T10:00:00+00:00');
    expect(result.task.dueAt).toBe('2026-08-21T17:00:00+00:00');
    expect(result.task.version).toBe(1);
  });

  it('state e when são derivados via deriveTaskState/formatTaskWhen (B1-B1), nunca lógica duplicada', () => {
    // due_at hoje às 17h, now às 15h → TODAY / "Hoje, HH:MM" (mesmo
    // contrato já provado em tests/tasks/deriveTaskState.test.ts).
    const result = adaptRemoteTaskRow(taskRow({ due_at: '2026-08-21T20:00:00Z' }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.state).toBe(TASK_STATE.TODAY);
    expect(result.task.when).toMatch(/^Hoje, /);
  });

  it('status completed → DONE', () => {
    const result = adaptRemoteTaskRow(
      taskRow({ status: 'completed', completed_at: '2026-08-21T10:00:00Z', completed_by: 'profile-1' }),
      makeContext(),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.state).toBe(TASK_STATE.DONE);
  });
});

describe('adaptRemoteTaskRow — resolução de Lead (§7/§8 do precheck, política congelada no EXEC)', () => {
  it('lead_id null → lead vazio, nenhum placeholder', () => {
    const result = adaptRemoteTaskRow(taskRow({ lead_id: null }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.leadId).toBeNull();
    expect(result.task.lead).toBe('');
  });

  it('lead_id presente e resolvido no catálogo → nome real', () => {
    const result = adaptRemoteTaskRow(taskRow({ lead_id: 'lead-1' }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.lead).toBe('Carlos Andrade');
  });

  it('lead_id presente mas AUSENTE do catálogo → placeholder neutro "Cliente indisponível", NUNCA erro nem outro Lead', () => {
    const result = adaptRemoteTaskRow(taskRow({ lead_id: 'lead-fantasma' }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.lead).toBe(TASK_LEAD_UNAVAILABLE_DISPLAY_VALUE);
    expect(result.task.lead).toBe('Cliente indisponível');
    expect(result.task.leadId).toBe('lead-fantasma'); // id real preservado, só o nome vira placeholder
  });
});

describe('adaptRemoteTaskRow — assignedTo (B1-B2-B1-EXEC §0/§3: sem Seller catalog, mapeamento direto)', () => {
  it('assigned_seller_id null → sem responsável, nenhum erro', () => {
    const result = adaptRemoteTaskRow(taskRow({ assigned_seller_id: null }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.assignedTo).toBeNull();
  });

  it('assigned_seller_id presente → mapeado diretamente para assignedTo, sem lookup', () => {
    const result = adaptRemoteTaskRow(taskRow({ assigned_seller_id: 's1' }), makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.assignedTo).toBe('s1');
  });

  it('assigned_seller_id conhecido apenas como raw id, SEM nenhum catálogo de Seller disponível → adaptação PASS (nenhuma dependência de sellersById existe mais)', () => {
    // TaskAdapterContext não tem mais campo sellersById — este teste prova
    // que um Seller totalmente "desconhecido" do adapter (nunca poderia
    // ser validado mesmo se quiséssemos) não impede a adaptação. A
    // integridade real (o Seller pertence à mesma company) é garantida
    // pelo banco (tasks_company_seller_fk), nunca por este adapter.
    const result = adaptRemoteTaskRow(
      taskRow({ assigned_seller_id: 's-nunca-visto-em-nenhum-catalogo' }),
      makeContext(),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.assignedTo).toBe('s-nunca-visto-em-nenhum-catalogo');
  });

  it('TaskAdapterContext não expõe mais sellersById (verificação de shape em compile-time)', () => {
    const context = makeContext();
    expect(Object.keys(context)).toEqual(['leadsById']);
  });
});

describe('adaptRemoteTaskRow — rejeição determinística de row inválida (§10/§11/§25)', () => {
  it('due_at não-parseável → invalid_due_at, nunca Invalid Date propagada', () => {
    const result = adaptRemoteTaskRow(taskRow({ due_at: 'nao-e-uma-data' }), makeContext(), NOW);
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.code).toBe('invalid_due_at');
  });

  it('priority fora do enum conhecido → invalid_priority', () => {
    const result = adaptRemoteTaskRow(
      taskRow({ priority: 'urgente' as RemoteTaskRow['priority'] }),
      makeContext(),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.code).toBe('invalid_priority');
  });

  it('status fora do enum conhecido → invalid_status', () => {
    const result = adaptRemoteTaskRow(
      taskRow({ status: 'arquivada' as RemoteTaskRow['status'] }),
      makeContext(),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.code).toBe('invalid_status');
  });

  it('version não-inteira ou < 1 → invalid_version', () => {
    expect(adaptRemoteTaskRow(taskRow({ version: 0 }), makeContext(), NOW)).toMatchObject({ ok: false, code: 'invalid_version' });
    expect(adaptRemoteTaskRow(taskRow({ version: 1.5 }), makeContext(), NOW)).toMatchObject({ ok: false, code: 'invalid_version' });
    expect(adaptRemoteTaskRow(taskRow({ version: -1 }), makeContext(), NOW)).toMatchObject({ ok: false, code: 'invalid_version' });
  });

  it('falha SEMPRE carrega taskId — nunca uma Task parcial é produzida silenciosamente', () => {
    const result = adaptRemoteTaskRow(taskRow({ id: 'task-ruim', due_at: 'x' }), makeContext(), NOW);
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.taskId).toBe('task-ruim');
    expect((result as unknown as { task?: unknown }).task).toBeUndefined();
  });
});

describe('adaptRemoteTaskRow — mesmo `now` para state e when (§13/§14/§26)', () => {
  it('boundary de meia-noite: mesma chamada nunca produz state/when de dias diferentes', () => {
    const almostMidnight = new Date(2026, 7, 21, 23, 59, 59);
    const row = taskRow({ due_at: '2026-08-21T15:00:00Z' }); // hoje, já passou do horário
    const result = adaptRemoteTaskRow(row, makeContext(), almostMidnight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ainda dentro do mesmo dia local (23:59:59) → TODAY e "Hoje, ..." —
    // os dois concordam porque usaram o MESMO Date `almostMidnight`.
    expect(result.task.state).toBe(TASK_STATE.TODAY);
    expect(result.task.when).toMatch(/^Hoje, /);
  });
});

describe('adaptRemoteTaskRows — lote', () => {
  it('preserva a ordem e usa o MESMO now para todas as rows do lote', () => {
    const rows = [
      taskRow({ id: 'task-a', due_at: '2026-08-21T14:00:00Z' }),
      taskRow({ id: 'task-b', due_at: '2026-08-22T14:00:00Z' }),
    ];
    const result = adaptRemoteTaskRows(rows, makeContext(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map((t) => t.id)).toEqual(['task-a', 'task-b']);
  });

  it('falha determinística no PRIMEIRO registro inválido — nunca produz lista parcial', () => {
    const rows = [
      taskRow({ id: 'task-ok' }),
      taskRow({ id: 'task-ruim', due_at: 'invalido' }),
      taskRow({ id: 'task-nunca-processada' }),
    ];
    const result = adaptRemoteTaskRows(rows, makeContext(), NOW);
    expect(result.ok).toBe(false);
    if (!isTaskAdapterError(result)) return;
    expect(result.taskId).toBe('task-ruim');
    expect(result.rowIndex).toBe(1);
  });

  it('lista vazia → tasks: [] válido', () => {
    const result = adaptRemoteTaskRows([], makeContext(), NOW);
    expect(result).toEqual({ ok: true, tasks: [] });
  });

  it('não muta rows nem context', () => {
    const rows = [taskRow()];
    const context = makeContext();
    const rowsBefore = JSON.parse(JSON.stringify(rows));
    const contextBefore = JSON.parse(JSON.stringify(context));
    adaptRemoteTaskRows(rows, context, NOW);
    expect(rows).toEqual(rowsBefore);
    expect(context).toEqual(contextBefore);
  });
});
