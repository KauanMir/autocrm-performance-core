// Testes de isolamento por modo de ScreenPendencias (COMMERCIAL-REMOTE-B1-
// B3-C1/C2). Task tem backend remoto próprio — o gate deixou de ser
// isLocalCommercialDataAllowed() (modo de LEADS, achado do precheck B) e
// passou a ser remoteTasksScreen.mode (resolveTaskRemoteMode(), via
// useRemoteTasksScreenState). useCompleteTask (C2) é mockado diretamente no
// nível da tela pelo mesmo motivo — evita precisar de um QueryClientProvider
// real e dá controle determinístico sobre isPending/error/completeTask,
// sem retestar a integração já coberta em
// tests/tasks/taskMutationsIntegration.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteTasksError } from '@/lib/tasks/errors';

const m = vi.hoisted(() => ({
  useRemoteTasksScreenState: vi.fn(),
  useCompleteTask: vi.fn(),
  tasks: vi.fn(() => [] as any[]),
  taskServiceUpdate: vi.fn(),
  leadServiceGetAll: vi.fn(() => [] as any[]),
  user: { current: null as any },
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteTasksScreenState', () => ({
  useRemoteTasksScreenState: m.useRemoteTasksScreenState,
}));

vi.mock('@/lib/hooks/useCompleteTask', () => ({
  useCompleteTask: m.useCompleteTask,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: () => ({
    mode: 'local',
    pipeline: { source: 'local', stages: [], byId: {}, byCode: {}, byName: {}, isLoading: false, isFetching: false, isError: false, error: null, configError: null, isEmpty: false, hasData: false, refetch: () => {}, queryEnabled: false, remoteStagesEnabled: false },
    leads: { leads: [], isLoading: false, isFetching: false, isError: false, error: null, configError: null, isEmpty: true, hasData: false, refetch: () => {}, queryEnabled: false, remoteLeadsEnabled: false },
    sellerLabels: { sellerLabels: [], sellersById: {}, isLoading: false, isFetching: false, isError: false, error: null, isEmpty: true, hasData: false, refetch: () => {}, queryEnabled: false, remoteLeadsEnabled: false },
  }),
}));
vi.mock('@/lib/hooks/useRemoteLeadStageMoveController', () => ({
  useRemoteLeadStageMoveController: () => ({
    attemptMove: vi.fn(), isLeadPending: () => false, errorCodeByLead: {}, clearError: vi.fn(),
  }),
}));
vi.mock('@/lib/flags', () => ({ isSuperAdminCommercialReadEnabled: () => false }));
vi.mock('@/components/commercial/PlatformCommercialClientsView', () => ({ PlatformCommercialClientsView: () => <div /> }));
vi.mock('@/components/commercial/PlatformCommercialPipelineView', () => ({ PlatformCommercialPipelineView: () => <div /> }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: m.leadServiceGetAll },
  TaskService: { getAll: () => m.tasks(), update: m.taskServiceUpdate },
  PipelineService: { getStages: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  SellerService: { getAll: () => [] },
}));

import { ScreenPendencias } from '@/components/screens/ScreensOps';

function taskScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, tasks: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function remoteTask(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't-remote-1', title: 'Ligar para Cliente Remoto', lead: 'Cliente Remoto', leadId: 'lead-remote-1',
    assignedTo: 's1', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '', createdAt: '2026-08-19T12:00:00Z',
    dueAt: '2026-08-19T12:00:00Z', version: 3,
    ...over,
  };
}

// Cada TaskRow monta sua PRÓPRIA instância de useCompleteTask — o mock
// central expõe um completeTask spy comum (para asserts de payload) mas
// isPending por chamada é controlado via m.completePendingTaskId.current.
function completeHookResult(completeTask: any) {
  return { completeTask, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() };
}

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };

let completeTaskSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  m.tasks.mockReset().mockReturnValue([]);
  m.taskServiceUpdate.mockReset();
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.useRemoteTasksScreenState.mockReset().mockReturnValue(taskScreenState('task_local'));
  completeTaskSpy = vi.fn().mockResolvedValue({});
  m.useCompleteTask.mockReset().mockImplementation(() => completeHookResult(completeTaskSpy));
  m.user.current = LOCAL_MANAGER;
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

describe('ScreenPendencias — task_local (preservado)', () => {
  it('renderiza pendências locais, Nova pendência presente, Reagendar presente, concluir local funciona', () => {
    m.tasks.mockReturnValue([{ id: 't1', title: 'Ligar para Juliana', lead: 'Juliana', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByText('Ligar para Juliana')).toBeInTheDocument();
    expect(screen.getByText('Nova pendência')).toBeInTheDocument();
    expect(screen.getByText('Reagendar')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Concluir pendência'));
    expect(m.taskServiceUpdate).toHaveBeenCalledWith('t1', { state: 'concluida' });
    expect(completeTaskSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Juliana'));
    expect(m.leadServiceGetAll).toHaveBeenCalled();
  });
});

describe.each([
  ['task_blocked'],
  ['task_remote_misconfigured'],
] as const)('ScreenPendencias — %s', (mode) => {
  it('nenhuma Task local exibida, TaskService.getAll não chamado, Nova pendência ausente', () => {
    m.tasks.mockReturnValue([{ id: 't1', title: 'Ligar para Cliente Antigo', lead: 'Cliente Antigo', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState(mode));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByTestId('pendencias-state-unavailable')).toBeInTheDocument();
    expect(m.tasks).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Nova pendência')).toBeNull();
  });
});

describe('ScreenPendencias — task_remote_unavailable_identity', () => {
  it('estado neutro, nenhuma Task antiga, nunca "0 pendências"', () => {
    m.tasks.mockReturnValue([{ id: 't1', title: 'X', lead: 'Y', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByTestId('pendencias-state-unavailable-identity')).toBeInTheDocument();
    expect(m.tasks).not.toHaveBeenCalled();
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('ScreenPendencias — task_remote_active loading', () => {
  it('mostra loading, ignora 10 Tasks locais, TaskService.getAll não chamado', () => {
    m.tasks.mockReturnValue(Array.from({ length: 10 }, (_, i) => ({ id: `local-${i}`, title: 'Local', lead: 'X', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' })));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByTestId('pendencias-state-loading')).toBeInTheDocument();
    expect(m.tasks).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();
  });
});

describe('ScreenPendencias — task_remote_active error', () => {
  it('mostra erro recuperável, chama refetch ao clicar em Tentar novamente, zero Tasks locais', () => {
    m.tasks.mockReturnValue([{ id: 'local-1', title: 'Local', lead: 'X', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    const refetch = vi.fn();
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isError: true, error: new Error('x'), refetch }));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByTestId('pendencias-state-error')).toBeInTheDocument();
    expect(m.tasks).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();

    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('ScreenPendencias — task_remote_active configError', () => {
  it('mensagem de configuração inválida, sem lista parcial, sem detalhe técnico', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      configError: { ok: false, reason: 'invalid_task_configuration', code: 'invalid_priority', taskId: 't1', rowIndex: 0 },
    }));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByTestId('pendencias-state-config-error')).toBeInTheDocument();
    expect(screen.queryByText(/invalid_priority/)).toBeNull();
    expect(screen.queryByText(/SQL|Postgres|Supabase/i)).toBeNull();
  });
});

describe('ScreenPendencias — task_remote_active com dado (C1 preservado)', () => {
  it('renderiza grupos a partir de remote.tasks, Nova pendência/Reagendar ausentes, TaskService.getAll 0 calls', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [remoteTask({ id: 't-remote-1', state: 'atrasada' }), remoteTask({ id: 't-remote-2', state: 'hoje', title: 'Follow-up remoto' })],
    }));

    render(<ScreenPendencias go={() => {}} />);
    // Tab padrão é "Atrasadas" — trocar para "Todas" para ver os dois grupos.
    fireEvent.click(screen.getByText('Todas'));

    expect(screen.getByText('Ligar para Cliente Remoto')).toBeInTheDocument();
    expect(screen.getByText('Follow-up remoto')).toBeInTheDocument();
    expect(screen.queryByText('Nova pendência')).toBeNull();
    expect(screen.queryByText('Reagendar')).toBeNull();
    expect(m.tasks).not.toHaveBeenCalled();
  });

  it('nome do Lead aparece como texto, sem lookup/flow — LeadService.getAll nunca chamado', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [remoteTask({ lead: 'Cliente Remoto', leadId: 'lead-remote-1' })],
    }));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getByText('Cliente')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cliente'));
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.openFlow).not.toHaveBeenCalledWith('ver-cliente', expect.anything());
  });
});

describe('ScreenPendencias — task_remote_active vazio', () => {
  it('reusa o card verde por grupo existente, nenhuma Task local', () => {
    m.tasks.mockReturnValue([{ id: 'local-1', title: 'Local', lead: 'X', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isEmpty: true, tasks: [] }));

    render(<ScreenPendencias go={() => {}} />);

    expect(screen.getAllByText('Tudo em dia por aqui. Ótimo trabalho!').length).toBeGreaterThan(0);
    expect(screen.queryByText('Local')).toBeNull();
  });
});

describe('ScreenPendencias — transição local → remote loading', () => {
  it('Task local desaparece imediatamente, loading aparece', () => {
    m.tasks.mockReturnValue([{ id: 't1', title: 'Ligar para Juliana', lead: 'Juliana', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_local'));

    const { rerender } = render(<ScreenPendencias go={() => {}} />);
    expect(screen.getByText('Ligar para Juliana')).toBeInTheDocument();

    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    rerender(<ScreenPendencias go={() => {}} />);

    expect(screen.queryByText('Ligar para Juliana')).toBeNull();
    expect(screen.getByTestId('pendencias-state-loading')).toBeInTheDocument();
  });
});

// ── COMMERCIAL-REMOTE-B1-B3-C2 — conclusão remota ──────────────────────────

describe('ScreenPendencias — conclusão remota: payload e version', () => {
  it('completeTask chamado com {taskId, expectedVersion: task.version} exato, TaskService.update 0 calls', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask({ id: 'task-1', version: 7 })],
    }));

    render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));

    expect(completeTaskSpy).toHaveBeenCalledWith({ taskId: 'task-1', expectedVersion: 7 });
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();
  });

  it('version inválida (ausente/não-inteira): completeTask 0 calls, nenhuma version inventada', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask({ id: 'task-bad', version: undefined as any })],
    }));

    render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));

    expect(completeTaskSpy).not.toHaveBeenCalled();
  });
});

describe('ScreenPendencias — conclusão remota: pending/double-submit', () => {
  it('isPending=true: controle desabilitado, clique não gera segunda mutation', () => {
    m.useCompleteTask.mockImplementation(() => ({
      completeTask: completeTaskSpy, isPending: true, isError: false, isSuccess: false, error: null, reset: vi.fn(),
    }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask()],
    }));

    render(<ScreenPendencias go={() => {}} />);
    const checkbox = screen.getByTitle('Concluir pendência') as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);

    fireEvent.click(checkbox);
    expect(completeTaskSpy).not.toHaveBeenCalled();
  });

  it('Task A pending não bloqueia conclusão da Task B (instância por row)', () => {
    const completeA = vi.fn().mockResolvedValue({});
    const completeB = vi.fn().mockResolvedValue({});
    m.useCompleteTask.mockImplementation(() => {
      // Cada TaskRow monta sua própria chamada — a primeira (Task A) fica
      // pending, a segunda (Task B) permanece livre.
      const callIndex = m.useCompleteTask.mock.calls.length;
      return callIndex === 1
        ? { completeTask: completeA, isPending: true, isError: false, isSuccess: false, error: null, reset: vi.fn() }
        : { completeTask: completeB, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() };
    });
    // Ambas em 'atrasada' (mesmo grupo, tab padrão) — evita um segundo passe
    // de render ao trocar de tab, que chamaria useCompleteTask de novo para
    // a Task já montada antes da Task nova montar pela primeira vez.
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask({ id: 'task-a', state: 'atrasada' }), remoteTask({ id: 'task-b', title: 'Task B', version: 2, state: 'atrasada' })],
    }));

    render(<ScreenPendencias go={() => {}} />);
    const checkboxes = screen.getAllByTitle('Concluir pendência') as HTMLButtonElement[];
    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[1].disabled).toBe(false);

    fireEvent.click(checkboxes[1]);
    expect(completeB).toHaveBeenCalledWith({ taskId: 'task-b', expectedVersion: 2 });
    expect(completeA).not.toHaveBeenCalled();
  });
});

describe('ScreenPendencias — conclusão remota: sucesso (wiring, sem reconstruir integração)', () => {
  it('completeTask chamado; rerender do screen-state sem a Task faz a row desaparecer, sem remoção otimista', async () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask({ id: 'task-1' })],
    }));

    const { rerender } = render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));
    await waitFor(() => expect(completeTaskSpy).toHaveBeenCalled());

    // Antes do refetch resolver: a row continua na tela (sem remoção manual).
    expect(screen.getByText('Ligar para Cliente Remoto')).toBeInTheDocument();

    // useCompleteTask já invalida/refetcha por conta própria (coberto em
    // tests/tasks/taskMutationsIntegration.test.tsx) — aqui só simulamos o
    // resultado desse refetch chegando ao screen-state.
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    rerender(<ScreenPendencias go={() => {}} />);

    expect(screen.queryByText('Ligar para Cliente Remoto')).toBeNull();
  });
});

describe.each([
  ['stale_write', 'remote_tasks_mutation_stale_write', 'Esta pendência foi alterada. Os dados foram atualizados.'],
  ['already_completed', 'remote_tasks_mutation_already_completed', 'Esta pendência já foi concluída.'],
  ['task_not_found', 'remote_tasks_mutation_task_not_found', 'Esta pendência não está mais disponível.'],
  ['forbidden', 'remote_tasks_mutation_forbidden', 'Você não tem permissão para concluir esta pendência.'],
  ['generic', 'remote_tasks_mutation_generic_error', 'Não foi possível concluir a pendência. Tente novamente.'],
] as const)('ScreenPendencias — conclusão remota: erro %s', (_label, code, expectedMessage) => {
  it(`mostra "${expectedMessage}", sem TaskService.update, sem remoção manual`, async () => {
    completeTaskSpy.mockRejectedValueOnce(new RemoteTasksError(code as any, { operation: 'complete_task' }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask()],
    }));

    render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();
    // A row não é removida manualmente — ela só some quando o screen-state
    // (refetch) deixar de trazê-la, nunca por causa do erro em si.
    expect(screen.getByText('Ligar para Cliente Remoto')).toBeInTheDocument();
  });
});

describe('ScreenPendencias — conclusão remota: identity_changed', () => {
  it('nenhuma mensagem de erro é mostrada', async () => {
    completeTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_identity_changed', { operation: 'complete_task' }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask()],
    }));

    render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));

    await waitFor(() => expect(completeTaskSpy).toHaveBeenCalled());
    expect(screen.queryByTestId('task-complete-error')).toBeNull();
  });
});

describe('ScreenPendencias — conclusão remota: reset de erro', () => {
  it('nova tentativa limpa a mensagem de erro anterior antes do novo resultado', async () => {
    completeTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_stale_write', { operation: 'complete_task' }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [remoteTask()],
    }));

    render(<ScreenPendencias go={() => {}} />);
    fireEvent.click(screen.getByTitle('Concluir pendência'));
    expect(await screen.findByText('Esta pendência foi alterada. Os dados foram atualizados.')).toBeInTheDocument();

    completeTaskSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByTitle('Concluir pendência'));
    await waitFor(() => expect(screen.queryByText('Esta pendência foi alterada. Os dados foram atualizados.')).toBeNull());
  });
});
