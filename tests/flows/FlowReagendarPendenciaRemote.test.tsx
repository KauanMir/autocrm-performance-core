// Testes de FlowReagendarPendencia — cutover de reagendamento remoto
// (COMMERCIAL-REMOTE-B1-B3-E). useUpdateTask/resolveTaskRemoteMode são
// mockados diretamente no nível do componente — mesmo padrão de
// FlowNovaPendenciaRemote.test.tsx (evita QueryClientProvider real; a
// integração completa da mutation já está coberta em
// tests/tasks/taskMutationsIntegration.test.tsx). O caminho LOCAL
// (TaskService.update parcial) já tinha cobertura própria — reexercitado
// aqui só para provar que continua intacto.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteTasksError } from '@/lib/tasks/errors';
import { combineLocalDateAndTimeToIso } from '@/lib/tasks/dueAtHelpers';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  resolveTaskRemoteMode: vi.fn(),
  useUpdateTask: vi.fn(),
  taskServiceUpdate: vi.fn(),
}));

vi.mock('@/lib/tasks/remoteTasksMode', () => ({
  resolveTaskRemoteMode: m.resolveTaskRemoteMode,
}));
vi.mock('@/lib/hooks/useUpdateTask', () => ({
  useUpdateTask: m.useUpdateTask,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: m.taskServiceUpdate },
  SellerService: { getAll: () => [] },
}));

import { FlowReagendarPendencia } from '@/components/flows/Flows2';

function manager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function updateHookResult(updateTask: any, over: Partial<Record<string, unknown>> = {}) {
  return { updateTask, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}

function remoteTask(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1', title: 'Ligar para João', lead: 'João', leadId: null,
    assignedTo: 'seller-1', when: 'Hoje, 14:00', prio: 'alta', state: 'atrasada', note: '',
    // Longe de qualquer "hoje"/data escolhida nos testes de propósito —
    // evita colisão acidental com o no-op (achado real durante esta
    // implementação: 2026-08-19 é a data real do dia em que este lote foi
    // escrito, então usá-la aqui colidia com os testes de "Hoje"/"Esta
    // semana", que escolhem a data local real do runner).
    createdAt: '2020-01-01T12:00:00.000Z', dueAt: '2020-01-01T14:00:00.000Z', version: 7,
    ...over,
  };
}

let updateTaskSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any) {
  const close = vi.fn();
  render(<FlowReagendarPendencia payload={payload} close={close} />);
  return { close };
}

function fillWhenRemote(when: string, opts: { date?: string; time?: string } = {}) {
  fireEvent.click(screen.getByText(when));
  if (opts.time !== undefined) fireEvent.change(screen.getByLabelText('Hora'), { target: { value: opts.time } });
  if (opts.date !== undefined) fireEvent.change(screen.getByLabelText('Data'), { target: { value: opts.date } });
}

function localYMDForTest(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysForTest(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

beforeEach(() => {
  m.resolveTaskRemoteMode.mockReset().mockReturnValue('task_local');
  m.taskServiceUpdate.mockReset();
  updateTaskSpy = vi.fn().mockResolvedValue({});
  m.useUpdateTask.mockReset().mockImplementation(() => updateHookResult(updateTaskSpy));
  m.user.current = manager();
});

describe('FlowReagendarPendencia — task_local (preservado)', () => {
  it('Reagendar visível, TaskService.update parcial chamado como antes, updateTask remoto 0 calls, close síncrono', () => {
    const { close } = renderFlow({ task: { id: 't1', title: 'Ligar', when: 'Amanhã' } });
    expect(screen.getByRole('button', { name: 'Reagendar' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Esta semana'));
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(m.taskServiceUpdate).toHaveBeenCalledWith('t1', { when: 'Esta semana', state: 'proxima' });
    expect(updateTaskSpy).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — remote: payload full-replace', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('updateTask chamado com payload exato', async () => {
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalled());

    const call = updateTaskSpy.mock.calls[0][0];
    expect(call.taskId).toBe('task-1');
    expect(call.expectedVersion).toBe(7);
    expect(call.title).toBe('Ligar para João');
    expect(call.note).toBe('');
    expect(call.priority).toBe('alta');
    expect(call.assignedSellerId).toBe('seller-1');
    expect(new Date(call.dueAt).getFullYear()).toBe(2026);
    expect(new Date(call.dueAt).getMonth()).toBe(8);
    expect(new Date(call.dueAt).getDate()).toBe(1);
    expect(new Date(call.dueAt).getHours()).toBe(16);
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();
  });

  it('alterar somente a hora: title/note/priority/assignedSellerId/version reenviados intactos (full-replace)', async () => {
    renderFlow({ task: remoteTask({ title: 'Follow-up especial', note: 'ligar de manhã', prio: 'baixa', assignedTo: 'seller-9', version: 3 }) });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:15' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalled());

    const call = updateTaskSpy.mock.calls[0][0];
    expect(call.title).toBe('Follow-up especial');
    expect(call.note).toBe('ligar de manhã');
    expect(call.priority).toBe('baixa');
    expect(call.assignedSellerId).toBe('seller-9');
    expect(call.expectedVersion).toBe(3);
  });
});

describe('FlowReagendarPendencia — version inválida', () => {
  it.each([undefined, 0, Number.NaN, -1])('version=%s: updateTask 0 calls, nenhuma version inventada', (badVersion) => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    renderFlow({ task: remoteTask({ version: badVersion as any }) });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — responsável inválido', () => {
  it.each([null, '', '   '])('assignedTo=%s: updateTask 0 calls, mensagem de bloqueio, sem fallback', (badSeller) => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    renderFlow({ task: remoteTask({ assignedTo: badSeller as any }) });

    expect(screen.getByText('Esta pendência está sem um responsável válido. Não é possível reagendá-la agora.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Hora')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — dueAt: Hoje/Amanhã/Esta semana/Personalizado', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('Hoje 15:00 -> dueAt no dia local de hoje às 15:00', async () => {
    const now = new Date();
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Hoje', { time: '15:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(updateTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getFullYear()).toBe(now.getFullYear());
    expect(dueAt.getMonth()).toBe(now.getMonth());
    expect(dueAt.getDate()).toBe(now.getDate());
    expect(dueAt.getHours()).toBe(15);
  });

  it('Amanhã 08:00 -> próximo dia de calendário local', async () => {
    const tomorrow = addDaysForTest(new Date(), 1);
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Amanhã', { time: '08:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalled());

    const dueAt = new Date(updateTaskSpy.mock.calls[0][0].dueAt);
    expect(dueAt.getFullYear()).toBe(tomorrow.getFullYear());
    expect(dueAt.getMonth()).toBe(tomorrow.getMonth());
    expect(dueAt.getDate()).toBe(tomorrow.getDate());
    expect(dueAt.getHours()).toBe(8);
  });

  it('Esta semana dentro do intervalo -> sucesso', async () => {
    const now = new Date();
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Esta semana', { date: localYMDForTest(now), time: '11:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalled());
    expect(new Date(updateTaskSpy.mock.calls[0][0].dueAt).getDate()).toBe(now.getDate());
  });

  it('Esta semana fora do intervalo -> updateTask 0 calls', () => {
    const outOfRange = addDaysForTest(new Date(), 10);
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Esta semana', { date: localYMDForTest(outOfRange), time: '11:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — no-op', () => {
  it('novo dueAt igual ao atual -> updateTask 0 calls', () => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    const now = new Date();
    const todayYMD = localYMDForTest(now);
    const sameInstant = combineLocalDateAndTimeToIso({ date: todayYMD, time: '14:00' });
    const dueAt = sameInstant.ok ? sameInstant.iso : new Date().toISOString();

    renderFlow({ task: remoteTask({ dueAt }) });
    fillWhenRemote('Personalizado', { date: todayYMD, time: '14:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(updateTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — pending/double-submit', () => {
  it('isPending=true: clique não gera segunda chamada', () => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
    m.useUpdateTask.mockImplementation(() => updateHookResult(updateTaskSpy, { isPending: true }));
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });

    expect(screen.getByText('Reagendando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reagendando…'));
    expect(updateTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarPendencia — sucesso remoto', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('close() só é chamado depois do resolve, nunca antes; sem escrita local', async () => {
    const { close } = renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();
  });
});

describe.each([
  ['stale_write', 'remote_tasks_mutation_stale_write', 'Esta pendência foi alterada. Os dados foram atualizados.'],
  ['task_completed', 'remote_tasks_mutation_task_completed', 'Esta pendência já foi concluída.'],
  ['task_not_found', 'remote_tasks_mutation_task_not_found', 'Esta pendência não está mais disponível.'],
  ['forbidden', 'remote_tasks_mutation_forbidden', 'Você não tem permissão para reagendar esta pendência.'],
  ['seller_required', 'remote_tasks_mutation_seller_required', 'Esta pendência está sem um responsável válido.'],
  ['seller_not_found', 'remote_tasks_mutation_seller_not_found', 'O responsável desta pendência não está mais disponível.'],
  ['invalid_title', 'remote_tasks_mutation_invalid_title', 'Esta pendência possui dados inválidos e precisa ser atualizada.'],
] as const)('FlowReagendarPendencia — erro %s (REOPEN REQUIRED)', (_label, code, expectedMessage) => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it(`mostra "${expectedMessage}", bloqueia novos submits, sem sucesso`, async () => {
    updateTaskSpy.mockRejectedValueOnce(new RemoteTasksError(code as any, { operation: 'update_task' }));
    const { close } = renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(m.taskServiceUpdate).not.toHaveBeenCalled();

    // Segundo clique: bloqueado nesta instância, mesmo com dados "válidos".
    updateTaskSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateTaskSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FlowReagendarPendencia — erro genérico (RETRYABLE)', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('mostra mensagem, permite nova tentativa, erro anterior é limpo', async () => {
    updateTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_generic_error', { operation: 'update_task' }));
    renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(await screen.findByText('Não foi possível reagendar a pendência. Tente novamente.')).toBeInTheDocument();

    updateTaskSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateTaskSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Não foi possível reagendar a pendência. Tente novamente.')).toBeNull());
  });
});

describe('FlowReagendarPendencia — identity_changed', () => {
  beforeEach(() => {
    m.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  });

  it('fecha o flow, nenhuma mensagem de erro, nenhum sucesso declarado por engano', async () => {
    updateTaskSpy.mockRejectedValueOnce(new RemoteTasksError('remote_tasks_mutation_identity_changed', { operation: 'update_task' }));
    const { close } = renderFlow({ task: remoteTask() });
    fillWhenRemote('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText(/Não foi possível reagendar/)).toBeNull();
  });
});
