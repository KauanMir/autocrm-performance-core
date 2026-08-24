// Testes de FlowNovaPendencia — cutover de criação remota (COMMERCIAL-
// REMOTE-B1-B3-D). useCreateTask/useCurrentCompanyAssignableSellers/
// resolveTaskRemoteMode são mockados diretamente no nível do componente —
// mesmo padrão já usado em ScreenPendencias/Rail nesta série (evita
// QueryClientProvider real; a integração completa da mutation já está
// coberta em tests/tasks/taskMutationsIntegration.test.tsx). O caminho
// LOCAL (TaskService.create) já tinha cobertura própria — reexercitado aqui
// só para provar que continua intacto.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteTasksError } from '@/lib/tasks/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  resolveTaskRemoteMode: vi.fn(),
  useCreateTask: vi.fn(),
  useCurrentCompanyAssignableSellers: vi.fn(),
  taskServiceCreate: vi.fn(),
  sellerServiceGetAll: vi.fn(() => [] as any[]),
}));

vi.mock('@/lib/tasks/remoteTasksMode', () => ({
  resolveTaskRemoteMode: m.resolveTaskRemoteMode,
}));
vi.mock('@/lib/hooks/useCreateTask', () => ({
  useCreateTask: m.useCreateTask,
}));
vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({
  useCurrentCompanyAssignableSellers: m.useCurrentCompanyAssignableSellers,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: m.taskServiceCreate, update: vi.fn() },
  SellerService: { getAll: m.sellerServiceGetAll },
}));

import { FlowNovaPendencia } from '@/components/flows/Flows2';

function manager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}
function seller(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-self' },
    ...overrides,
  };
}

function createHookResult(createTask: any, over: Partial<Record<string, unknown>> = {}) {
  return { createTask, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function assignableSellersResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    assignableSellers: [{ seller_id: 's1', name: 'Ana' }],
    sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

let createTaskSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any = {}) {
  const close = vi.fn();
  render(<FlowNovaPendencia payload={payload} close={close} />);
  return { close };
}

// Formatos exigidos por <input type="date">/type="time"> (mesmos de
// dueAtHelpers.ts) — usados para fireEvent.change nos campos remotos.
function fillWhenRemote(when: string, opts: { date?: string; time?: string } = {}) {
  fireEvent.click(screen.getByText(when));
  if (opts.time !== undefined) fireEvent.change(screen.getByLabelText('Hora'), { target: { value: opts.time } });
  if (opts.date !== undefined) fireEvent.change(screen.getByLabelText('Data'), { target: { value: opts.date } });
}

beforeEach(() => {
  m.resolveTaskRemoteMode.mockReset().mockReturnValue('task_local');
  m.taskServiceCreate.mockReset();
  m.sellerServiceGetAll.mockReset().mockReturnValue([{ id: 'local-s1', name: 'Marcos Silva', first: 'Marcos' }]);
  createTaskSpy = vi.fn().mockResolvedValue({});
  m.useCreateTask.mockReset().mockImplementation(() => createHookResult(createTaskSpy));
  m.useCurrentCompanyAssignableSellers.mockReset().mockImplementation(() => assignableSellersResult());
  m.user.current = manager();
});

describe('FlowNovaPendencia — task_local (preservado)', () => {
  it('cria localmente com o payload de sempre, createTask remoto 0 calls', () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente'), { target: { value: 'Juliana' } });
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Marcos Silva'));
    fireEvent.click(screen.getByText('Criar pendência'));

    expect(m.taskServiceCreate).toHaveBeenCalledWith({
      title: 'Ligar: Juliana',
      lead: 'Juliana',
      leadId: null,
      state: 'hoje',
      prio: 'alta',
      when: 'Hoje',
      assignedTo: 'local-s1',
      note: '',
    });
    expect(createTaskSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Pendência criada!')).toBeInTheDocument();
  });
});

describe('FlowNovaPendencia — remote Manager create', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('mostra o SellerPicker remoto (assignable sellers), nunca SellerService local', async () => {
    renderFlow();
    expect(screen.getByText('Selecione o vendedor…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('cria com payload exato {actorRole:"manager", title, priority, dueAt, assignedSellerId, leadId, note}', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '14:30' });

    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const call = createTaskSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('manager');
    expect(call.assignedSellerId).toBe('s1');
    expect(call.leadId).toBeNull();
    expect(call.note).toBe('');
    expect(call.priority).toBe('alta');
    expect(m.taskServiceCreate).not.toHaveBeenCalled();
  });

  it('sem vendedor selecionado: createTask 0 calls', () => {
    renderFlow();
    fillWhenRemote('Hoje', { time: '14:30' });
    fireEvent.click(screen.getByText('Criar pendência'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });

  it('catálogo de vendedores carregando: createTask 0 calls mesmo com data/hora válidos', () => {
    m.useCurrentCompanyAssignableSellers.mockImplementation(() => assignableSellersResult({ isLoading: true, hasData: false, assignableSellers: [] }));
    renderFlow();
    fillWhenRemote('Hoje', { time: '14:30' });
    fireEvent.click(screen.getByText('Criar pendência'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowNovaPendencia — remote Seller create', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    m.user.current = seller();
  });

  it('sem picker de vendedor; createTask recebe actorRole:"seller" sem assignedSellerId', async () => {
    renderFlow();
    expect(screen.queryByText('Selecione o vendedor…')).toBeNull();

    fillWhenRemote('Hoje', { time: '09:00' });
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const call = createTaskSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('seller');
    expect('assignedSellerId' in call).toBe(false);
  });
});

// Sem vi.useFakeTimers() de propósito: waitFor (testing-library) depende de
// polling por timer real — misturar com fake timers sem
// vi.advanceTimersByTimeAsync trava o teste (achado desta própria etapa).
// Datas calculadas relativas ao "agora" real do runner, mesma fórmula do
// componente (nunca hardcoded para um dia específico).
function localYMDForTest(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysForTest(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

describe('FlowNovaPendencia — dueAt: Hoje/Amanhã/Esta semana/Personalizado', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('Hoje 14:30 -> dueAt no dia local de hoje às 14:30', async () => {
    const now = new Date();
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '14:30' });
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(createTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getFullYear()).toBe(now.getFullYear());
    expect(dueAt.getMonth()).toBe(now.getMonth());
    expect(dueAt.getDate()).toBe(now.getDate());
    expect(dueAt.getHours()).toBe(14);
    expect(dueAt.getMinutes()).toBe(30);
  });

  it('Amanhã 09:00 -> próximo dia de calendário local, nunca +24h em ms', async () => {
    const tomorrow = addDaysForTest(new Date(), 1);
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Amanhã', { time: '09:00' });
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(createTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getFullYear()).toBe(tomorrow.getFullYear());
    expect(dueAt.getMonth()).toBe(tomorrow.getMonth());
    expect(dueAt.getDate()).toBe(tomorrow.getDate());
    expect(dueAt.getHours()).toBe(9);
  });

  it('Esta semana com data dentro do intervalo (hoje..domingo) -> dueAt correto', async () => {
    const now = new Date();
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    // "Hoje" está sempre dentro do próprio intervalo [hoje, domingo].
    fillWhenRemote('Esta semana', { date: localYMDForTest(now), time: '11:00' });
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(createTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getDate()).toBe(now.getDate());
    expect(dueAt.getHours()).toBe(11);
  });

  it('Esta semana com data fora do intervalo -> createTask 0 calls', () => {
    // +10 dias sempre ultrapassa o domingo desta semana (no máximo +6).
    const outOfRange = addDaysForTest(new Date(), 10);
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Esta semana', { date: localYMDForTest(outOfRange), time: '11:00' });
    fireEvent.click(screen.getByText('Criar pendência'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });

  it('Personalizado (sem limite de semana) -> dueAt correto mesmo além do domingo', async () => {
    const future = addDaysForTest(new Date(), 30);
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Personalizado', { date: localYMDForTest(future), time: '16:45' });
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(createTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getFullYear()).toBe(future.getFullYear());
    expect(dueAt.getMonth()).toBe(future.getMonth());
    expect(dueAt.getDate()).toBe(future.getDate());
    expect(dueAt.getHours()).toBe(16);
    expect(dueAt.getMinutes()).toBe(45);
  });

  it('data/hora ausente ou inválida: createTask 0 calls', () => {
    const future = addDaysForTest(new Date(), 30);
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Personalizado', { date: localYMDForTest(future) }); // sem hora
    fireEvent.click(screen.getByText('Criar pendência'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowNovaPendencia — pending/double-submit', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('isPending=true: clique não gera segunda chamada', () => {
    // Seller (sem SellerPicker) — isPending=true desabilitaria o picker
    // remoto também, o que não é o que este teste quer exercitar.
    m.user.current = seller();
    m.useCreateTask.mockImplementation(() => createHookResult(createTaskSpy, { isPending: true }));
    renderFlow();
    fillWhenRemote('Hoje', { time: '10:00' });

    expect(screen.getByText('Criando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Criando…'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowNovaPendencia — sucesso remoto', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('FlowSuccess só aparece depois do resolve, nunca antes', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '10:00' });
    fireEvent.click(screen.getByText('Criar pendência'));

    expect(screen.queryByText('Pendência criada!')).toBeNull();
    await waitFor(() => expect(screen.getByText('Pendência criada!')).toBeInTheDocument());
  });
});

describe.each([
  ['forbidden', 'remote_tasks_mutation_forbidden', 'Você não tem permissão para criar esta pendência.'],
  ['seller_not_found', 'remote_tasks_mutation_seller_not_found', 'O responsável selecionado não está mais disponível.'],
  ['lead_not_found', 'remote_tasks_mutation_lead_not_found', 'O cliente vinculado não está mais disponível.'],
  ['invalid_title', 'remote_tasks_mutation_invalid_title', 'Informe um título válido para a pendência.'],
  ['generic', 'remote_tasks_mutation_generic_error', 'Não foi possível criar a pendência. Tente novamente.'],
] as const)('FlowNovaPendencia — erro %s', (_label, code, expectedMessage) => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it(`mostra "${expectedMessage}", nunca FlowSuccess, nunca TaskService.create`, async () => {
    createTaskSpy.mockRejectedValueOnce(new RemoteTasksError(code as any, { operation: 'create_task' }));
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '10:00' });
    fireEvent.click(screen.getByText('Criar pendência'));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(m.taskServiceCreate).not.toHaveBeenCalled();
    expect(screen.queryByText('Pendência criada!')).toBeNull();
  });
});

describe('FlowNovaPendencia — identity_changed', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('fecha o flow, nenhuma mensagem de erro, nenhum FlowSuccess', async () => {
    createTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_identity_changed', { operation: 'create_task' }));
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '10:00' });
    fireEvent.click(screen.getByText('Criar pendência'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Pendência criada!')).toBeNull();
  });
});

describe('FlowNovaPendencia — reset de erro', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('nova tentativa limpa o erro anterior', async () => {
    createTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_generic_error', { operation: 'create_task' }));
    renderFlow();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana'));
    fillWhenRemote('Hoje', { time: '10:00' });
    fireEvent.click(screen.getByText('Criar pendência'));
    expect(await screen.findByText('Não foi possível criar a pendência. Tente novamente.')).toBeInTheDocument();

    createTaskSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(screen.queryByText('Não foi possível criar a pendência. Tente novamente.')).toBeNull());
  });
});
