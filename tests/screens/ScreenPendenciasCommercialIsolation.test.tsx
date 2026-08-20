// Testes de isolamento por modo de ScreenPendencias (COMMERCIAL-REMOTE-B1-
// B3-C1). Task agora tem backend remoto próprio — o gate deixou de ser
// isLocalCommercialDataAllowed() (modo de LEADS, achado do precheck B) e
// passou a ser remoteTasksScreen.mode (resolveTaskRemoteMode(), via
// useRemoteTasksScreenState). O hook é mockado diretamente no nível da tela
// (mesmo padrão de tests/navigation/appHomeRailRemoteGuard.test.tsx para o
// Rail) — evita precisar de um QueryClientProvider real e dá controle
// determinístico sobre mode/isLoading/isError/configError/tasks.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteTasksScreenState: vi.fn(),
  tasks: vi.fn(() => [] as any[]),
  taskServiceUpdate: vi.fn(),
  leadServiceGetAll: vi.fn(() => [] as any[]),
  user: { current: null as any },
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteTasksScreenState', () => ({
  useRemoteTasksScreenState: m.useRemoteTasksScreenState,
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

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };

beforeEach(() => {
  m.tasks.mockReset().mockReturnValue([]);
  m.taskServiceUpdate.mockReset();
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.useRemoteTasksScreenState.mockReset().mockReturnValue(taskScreenState('task_local'));
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

describe('ScreenPendencias — task_remote_active com dado', () => {
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

  it('checkbox de concluir fica desabilitado e não chama TaskService.update', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [remoteTask()],
    }));

    render(<ScreenPendencias go={() => {}} />);

    const checkbox = screen.getByTitle('Concluir pendência') as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    fireEvent.click(checkbox);
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();
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
