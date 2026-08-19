// tests/tasks/taskServiceRemoteRead.test.ts — TaskService (COMMERCIAL-REMOTE-
// B1-B3-A): remote-read branch de getAll() + guard local próprio de Tasks
// (assertLocalTaskDataAllowed, nunca mais assertLocalCommercialDataAllowed).
//
// resolveTaskRemoteMode é mockado diretamente (mesmo padrão de
// tests/tasks/localTaskAccess.test.ts) para controlar os 4 modos
// deterministicamente, sem precisar coordenar múltiplas flags. supabase.from/
// rpc são espiados para provar que o branch remoto de getAll() nunca faz
// rede — só lê os snapshots já populados em memória pelo bridge (fora do
// escopo deste lote).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/data';
import { TASK_STATE } from '@/lib/data';
import { getStore } from '@/lib/store';
import { AuthService, TaskService } from '@/lib/services';
import { isLocalTaskDataDisabledError } from '@/lib/tasks/localTaskAccess';
import {
  buildRemoteTaskSnapshot,
  clearAllRemoteTaskSnapshots,
  setRemoteTaskSnapshot,
  type RemoteTaskSnapshotOwner,
} from '@/lib/tasks/remoteTaskSnapshot';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import {
  buildRemoteLeadSnapshot,
  clearAllRemoteLeadSnapshots,
  setRemoteLeadSnapshot,
  type RemoteLeadSnapshotOwner,
} from '@/lib/leads/remoteSnapshot';
import type { LeadAdapterContext } from '@/lib/leads/adapter';
import type { LeadRow } from '@/lib/supabase/types';

const mocks = vi.hoisted(() => ({
  resolveTaskRemoteMode: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, auth: { signOut: vi.fn() } },
  isSupabaseConfigured: false,
}));

vi.mock('@/lib/tasks/remoteTasksMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/remoteTasksMode')>();
  return { ...actual, resolveTaskRemoteMode: mocks.resolveTaskRemoteMode };
});

const MANAGER: User = {
  id: 'user-manager-1',
  name: 'Gestora Teste',
  email: 'gestora@teste.dev',
  activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
};

const SELLER: User = {
  id: 'user-seller-1',
  name: 'Vendedor Teste',
  email: 'vendedor@teste.dev',
  activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' },
};

const OWNER: RemoteTaskSnapshotOwner = { companyId: 'company-a', identityKey: MANAGER.id };
const SELLER_OWNER: RemoteTaskSnapshotOwner = { companyId: 'company-a', identityKey: SELLER.id };

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'remote-task-1',
    company_id: 'company-a',
    title: 'Ligar para cliente remoto',
    note: 'nota remota',
    priority: 'alta',
    status: 'pending',
    // Bem no futuro — evita flakiness com deriveTaskState (nunca LATE/TODAY
    // por acidente dependendo de quando o teste roda).
    due_at: '2099-06-15T12:00:00+00:00',
    lead_id: null,
    assigned_seller_id: 's1',
    created_at: '2026-08-19T12:00:00+00:00',
    updated_at: '2026-08-19T12:00:00+00:00',
    created_by: null,
    updated_by: null,
    completed_at: null,
    completed_by: null,
    version: 1,
    ...overrides,
  };
}

function setTaskSnapshotFor(owner: RemoteTaskSnapshotOwner, rows: RemoteTaskRow[]): void {
  setRemoteTaskSnapshot(buildRemoteTaskSnapshot(rows, owner));
}

const LEAD_CONTEXT: LeadAdapterContext = {
  stagesById: {
    'stage-new': { id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false },
  },
  sellersById: {},
};

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'remote-lead-1',
    company_id: 'company-a',
    name: 'Cliente Remoto',
    phone: '(11) 90000-0000',
    phone_digits: '11900000000',
    car: 'Golf GTI 2022',
    stage_id: 'stage-new',
    seller_id: null,
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato ainda',
    alert_label: 'Fazer primeiro contato',
    payment_preference: null,
    value_amount: null,
    source: null,
    created_by_profile_id: null,
    updated_by_profile_id: null,
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T12:00:00+00:00',
    ...overrides,
  };
}

function setLeadSnapshotFor(owner: RemoteLeadSnapshotOwner, rows: LeadRow[]): void {
  setRemoteLeadSnapshot(buildRemoteLeadSnapshot(rows, LEAD_CONTEXT, owner));
}

function setUser(user: User | null): void {
  vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue(user);
}

beforeEach(() => {
  mocks.resolveTaskRemoteMode.mockReset();
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllRemoteTaskSnapshots();
  clearAllRemoteLeadSnapshots();
});

// ── §17 — task_local: baseline preservado ──────────────────────────────────

describe('task_local: comportamento local preservado', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
    setUser(MANAGER);
  });

  it('getAll() lê da store local (seed padrão)', () => {
    expect(TaskService.getAll().length).toBeGreaterThan(0);
  });

  it('create/update continuam mutando a store local', () => {
    const before = getStore().tasks.length;
    TaskService.create({
      title: 'Nova pendência local', lead: 'Cliente X', leadId: null, assignedTo: null,
      when: 'Hoje', prio: 'alta', state: TASK_STATE.TODAY, note: '',
    });
    expect(getStore().tasks.length).toBe(before + 1);

    const created = getStore().tasks[getStore().tasks.length - 1];
    TaskService.update(created.id, { note: 'atualizada' });
    expect(TaskService.getAll().find((t) => t.id === created.id)?.note).toBe('atualizada');
  });
});

// ── §18/§19 — task_blocked / task_remote_misconfigured ──────────────────────

describe.each([
  ['task_blocked', 'task_blocked'],
  ['task_remote_misconfigured', 'task_remote_misconfigured'],
] as const)('%s: leitura e escrita local bloqueadas', (_label, mode) => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue(mode);
    setUser(MANAGER);
  });

  it('getAll() nunca retorna Tasks locais (zero fallback)', () => {
    expect(getStore().tasks.length).toBeGreaterThan(0); // seed local existe
    expect(TaskService.getAll()).toEqual([]);
  });

  it('create/update lançam LocalTaskDataDisabledError e nunca tocam a store', () => {
    const tasksBefore = JSON.stringify(getStore().tasks);

    expect(() => TaskService.create({
      title: 'X', lead: 'Y', leadId: null, assignedTo: null,
      when: 'Hoje', prio: 'alta', state: TASK_STATE.TODAY, note: '',
    })).toThrow();
    expect(() => TaskService.update('t1', { note: 'x' })).toThrow();

    try {
      TaskService.create({
        title: 'X', lead: 'Y', leadId: null, assignedTo: null,
        when: 'Hoje', prio: 'alta', state: TASK_STATE.TODAY, note: '',
      });
    } catch (e) {
      expect(isLocalTaskDataDisabledError(e)).toBe(true);
      if (isLocalTaskDataDisabledError(e)) {
        expect(e.code).toBe('remote_task_local_data_disabled');
        expect(e.operation).toBe('TaskService.create');
      }
    }

    expect(JSON.stringify(getStore().tasks)).toBe(tasksBefore);
  });
});

// ── §20/§21 — task_remote_ready: snapshot absent / empty ────────────────────

describe('task_remote_ready: snapshot remoto ausente ou vazio', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(MANAGER);
  });

  it('snapshot absent: [] mesmo com Tasks locais na store (zero fallback)', () => {
    expect(getStore().tasks.length).toBeGreaterThan(0);
    expect(TaskService.getAll()).toEqual([]);
  });

  it('snapshot presente com rows=[]: [] (resultado remoto válido, não "indisponível")', () => {
    setTaskSnapshotFor(OWNER, []);
    expect(TaskService.getAll()).toEqual([]);
  });
});

// ── §22 — remote data real ──────────────────────────────────────────────────

describe('task_remote_ready: dado remoto real', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(MANAGER);
  });

  it('getAll() retorna RemoteTaskModel/Task-compatível, Lead resolvido, sem nenhuma row local misturada', () => {
    setTaskSnapshotFor(OWNER, [taskRow({ lead_id: 'remote-lead-1', assigned_seller_id: 's1' })]);
    setLeadSnapshotFor(OWNER, [leadRow()]);

    const tasks = TaskService.getAll();
    expect(tasks).toHaveLength(1);

    const task = tasks[0];
    expect(task.id).toBe('remote-task-1');
    expect(task.title).toBe('Ligar para cliente remoto');
    expect(task.lead).toBe('Cliente Remoto');
    expect(task.leadId).toBe('remote-lead-1');
    expect(task.assignedTo).toBe('s1');
    expect(task.prio).toBe('alta');
    expect(task.state).toBe(TASK_STATE.UPCOMING);
    expect((task as any).dueAt).toBe('2099-06-15T12:00:00+00:00');
    expect((task as any).version).toBe(1);

    // Nenhuma Task local (seed da store) vazou para o resultado remoto.
    expect(tasks.every((t) => t.id === 'remote-task-1')).toBe(true);
  });

  it('nunca faz rede (sem from/rpc) — só lê o snapshot já populado', () => {
    setTaskSnapshotFor(OWNER, [taskRow()]);
    setLeadSnapshotFor(OWNER, [leadRow()]);

    TaskService.getAll();

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

// ── §23 — Lead snapshot ausente ──────────────────────────────────────────────

describe('task_remote_ready: Lead snapshot ausente', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(MANAGER);
  });

  it('Task com lead_id mas sem Lead snapshot: "Cliente indisponível", nunca throw', () => {
    setTaskSnapshotFor(OWNER, [taskRow({ lead_id: 'remote-lead-1' })]);
    // Lead snapshot deliberadamente NUNCA setado nesta suite.

    const tasks = TaskService.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].lead).toBe('Cliente indisponível');
  });
});

// ── §24 — RLS é a autoridade, sem filtro local extra ────────────────────────

describe('task_remote_ready: resultado remoto preservado sem RBAC local extra', () => {
  it('Seller vendo Task atribuída a OUTRO seller (RLS decidiu) não é removida por _filteredTasks', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(SELLER);
    // assigned_seller_id !== SELLER.activeMembership.sellerId ('s1') — o
    // filtro local antigo (_filteredTasks) removeria esta row. O branch
    // remoto NUNCA deve aplicar esse filtro: RLS já decidiu a visibilidade.
    setTaskSnapshotFor(SELLER_OWNER, [taskRow({ id: 'remote-task-other-seller', assigned_seller_id: 's2' })]);

    const tasks = TaskService.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assignedTo).toBe('s2');
  });
});

// ── §25 — identidade inválida ────────────────────────────────────────────────

describe('task_remote_ready: identidade inválida', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('sem usuário autenticado: []', () => {
    setUser(null);
    expect(getStore().tasks.length).toBeGreaterThan(0);
    expect(TaskService.getAll()).toEqual([]);
  });

  it('usuário sem activeMembership (ex.: Super Admin): []', () => {
    setUser({ id: 'super-1', name: 'Super', email: 'super@teste.dev', platformRole: 'super_admin' } as User);
    expect(TaskService.getAll()).toEqual([]);
  });
});

// ── §26 — falha de adaptação não quebra o shell ─────────────────────────────

describe('task_remote_ready: falha do adapter', () => {
  it('row remota inválida (priority fora do enum): [], nunca throw', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(MANAGER);
    setTaskSnapshotFor(OWNER, [taskRow({ priority: 'urgente' as any })]);

    expect(() => TaskService.getAll()).not.toThrow();
    expect(TaskService.getAll()).toEqual([]);
  });
});

// ── §27 — writes nunca remotos ───────────────────────────────────────────────

describe('task_remote_ready: writes nunca passam pelo caminho remoto', () => {
  beforeEach(() => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    setUser(MANAGER);
  });

  it('create/update lançam LocalTaskDataDisabledError, nunca tocam StoreAdapter nem rede', () => {
    const tasksBefore = JSON.stringify(getStore().tasks);

    expect(() => TaskService.create({
      title: 'X', lead: 'Y', leadId: null, assignedTo: null,
      when: 'Hoje', prio: 'alta', state: TASK_STATE.TODAY, note: '',
    })).toThrow();
    expect(() => TaskService.update('t1', { note: 'x' })).toThrow();

    expect(JSON.stringify(getStore().tasks)).toBe(tasksBefore);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
