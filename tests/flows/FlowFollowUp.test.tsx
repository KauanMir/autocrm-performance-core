// Testes de FlowFollowUp (FOLLOW-UP-TEMPLATES-A3-EXEC) — picker de
// templates + confirmação. Mesmo padrão de mock de
// tests/flows/FlowNovaPendenciaRemote.test.tsx: hooks mockados no nível do
// componente, useCreateTask/useCurrentCompanyAssignableSellers/
// useActiveFollowUpTemplates/AuthService mockados diretamente — evita
// QueryClientProvider real.
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  useCreateTask: vi.fn(),
  useCurrentCompanyAssignableSellers: vi.fn(),
  useActiveFollowUpTemplates: vi.fn(),
  canManageFollowUpTemplates: vi.fn(),
}));

vi.mock('@/lib/hooks/useCreateTask', () => ({ useCreateTask: m.useCreateTask }));
vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({ useCurrentCompanyAssignableSellers: m.useCurrentCompanyAssignableSellers }));
vi.mock('@/lib/hooks/useActiveFollowUpTemplates', () => ({ useActiveFollowUpTemplates: m.useActiveFollowUpTemplates }));
vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return { ...actual, canManageFollowUpTemplates: m.canManageFollowUpTemplates };
});
vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowFollowUp } from '@/components/flows/Flows2';

function manager() {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
}
function seller() {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-self' },
  };
}

const LEAD = { id: 'lead-1', name: 'Carlos Silva', sellerId: 'seller-original' };

function template(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tpl-1', companyId: 'company-a', name: 'Cliente pediu para pensar', taskTitle: 'Retomar contato',
    taskNote: '', priority: 'media', offsetValue: 2, offsetUnit: 'day', defaultTime: '09:00',
    isActive: true, sortOrder: 0, createdBy: 'p1', updatedBy: 'p1', createdAt: 't', updatedAt: 't', version: 1,
    ...overrides,
  };
}

function templatesResult(templates: any[], overrides: Partial<Record<string, unknown>> = {}) {
  return { templates, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...overrides };
}
function createHookResult(createTask: any, over: Partial<Record<string, unknown>> = {}) {
  return { createTask, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function assignableSellersResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    assignableSellers: [{ seller_id: 'seller-original', name: 'Ana' }, { seller_id: 'seller-other', name: 'Bruno' }],
    isLoading: false, isError: false, ...over,
  };
}

let createTaskSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any = { lead: LEAD }) {
  const close = vi.fn();
  const openFlow = vi.fn();
  const go = vi.fn();
  render(<FlowFollowUp payload={payload} close={close} openFlow={openFlow} go={go} />);
  return { close, openFlow, go };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 20, 14, 0, 0));
  m.user.current = manager();
  createTaskSpy = vi.fn().mockResolvedValue({});
  m.useCreateTask.mockReset().mockImplementation(() => createHookResult(createTaskSpy));
  m.useCurrentCompanyAssignableSellers.mockReset().mockImplementation(() => assignableSellersResult());
  m.useActiveFollowUpTemplates.mockReset().mockImplementation(() => templatesResult([template()]));
  m.canManageFollowUpTemplates.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FlowFollowUp — cliente indisponível', () => {
  it('sem payload.lead: estado seguro, nunca abre outro cliente', () => {
    renderFlow({});
    expect(screen.getByText('Cliente indisponível')).toBeInTheDocument();
  });
});

describe('FlowFollowUp — etapa 1: picker', () => {
  it('carregando: mostra estado de loading', () => {
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([], { isLoading: true }));
    renderFlow();
    expect(screen.getByText('Carregando follow-ups…')).toBeInTheDocument();
  });

  it('lista os templates com nome e subtítulo humano, nunca offset cru', () => {
    renderFlow();
    expect(screen.getByText('Cliente pediu para pensar')).toBeInTheDocument();
    expect(screen.getByText('Em 2 dias às 09:00')).toBeInTheDocument();
    expect(screen.getByText('Personalizado')).toBeInTheDocument();
  });

  it('vazio: mensagem + "Criar pendência personalizada", Manager também vê "Configurar follow-ups"', () => {
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([]));
    renderFlow();
    expect(screen.getByText('Nenhum follow-up configurado.')).toBeInTheDocument();
    expect(screen.getByText('Criar pendência personalizada')).toBeInTheDocument();
    expect(screen.getByText('Configurar follow-ups')).toBeInTheDocument();
  });

  it('vazio: Seller NUNCA vê "Configurar follow-ups"', () => {
    m.user.current = seller();
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([]));
    renderFlow();
    expect(screen.getByText('Criar pendência personalizada')).toBeInTheDocument();
    expect(screen.queryByText('Configurar follow-ups')).toBeNull();
  });

  it('"Criar pendência personalizada" fecha o flow e abre nova-pendencia com o Lead', () => {
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([]));
    const { close, openFlow } = renderFlow();
    fireEvent.click(screen.getByText('Criar pendência personalizada'));
    expect(close).toHaveBeenCalled();
    expect(openFlow).toHaveBeenCalledWith('nova-pendencia', { lead: LEAD });
  });

  it('"Personalizado" fecha o flow e abre nova-pendencia (nunca duplica o formulário manual)', () => {
    const { close, openFlow } = renderFlow();
    fireEvent.click(screen.getByText('Personalizado'));
    expect(close).toHaveBeenCalled();
    expect(openFlow).toHaveBeenCalledWith('nova-pendencia', { lead: LEAD });
  });

  it('selecionar um template NUNCA cria a Task imediatamente — vai para confirmação', () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    expect(createTaskSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Confirmar pendência')).toBeInTheDocument();
  });
});

describe('FlowFollowUp — etapa 2: confirmação (Manager)', () => {
  it('mostra título/cliente/quando/prioridade calculados, e o SellerPicker pré-preenchido com lead.sellerId', () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    expect(screen.getByText('Retomar contato')).toBeInTheDocument();
    expect(screen.getByText('Carlos Silva')).toBeInTheDocument();
    expect(screen.getByText('Média')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument(); // seller-original = Ana
  });

  it('template com offset_unit=day SEM default_time: exige Hora antes de confirmar', () => {
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([template({ defaultTime: null })]));
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    const confirmBtn = screen.getByText('Criar pendência');
    expect(confirmBtn.closest('button')).toHaveStyle({ opacity: '0.5' });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '10:00' } });
    expect(confirmBtn.closest('button')).toHaveStyle({ opacity: '1' });
  });

  it('template com offset_unit=hour: nunca pede Hora extra', () => {
    m.useActiveFollowUpTemplates.mockReturnValue(templatesResult([template({ offsetUnit: 'hour', offsetValue: 1, defaultTime: null })]));
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    expect(screen.queryByLabelText('Hora')).toBeNull();
  });

  it('confirmar chama createTask com actorRole manager, assignedSellerId, taskTitle/priority/note do template e leadId do Lead aberto', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalledTimes(1));
    expect(createTaskSpy).toHaveBeenCalledWith(expect.objectContaining({
      actorRole: 'manager',
      title: 'Retomar contato',
      priority: 'media',
      assignedSellerId: 'seller-original',
      leadId: 'lead-1',
      note: '',
    }));
    expect(screen.getByText('Pendência criada!')).toBeInTheDocument();
  });

  it('trocar o responsável antes de confirmar envia o novo seller', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Ana'));
    fireEvent.click(screen.getByText('Bruno'));
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalledTimes(1));
    expect(createTaskSpy).toHaveBeenCalledWith(expect.objectContaining({ assignedSellerId: 'seller-other' }));
  });

  it('Voltar retorna ao picker sem criar Task', () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Voltar'));
    expect(screen.getByText('Cliente pediu para pensar')).toBeInTheDocument();
    expect(createTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowFollowUp — etapa 2: confirmação (Seller)', () => {
  beforeEach(() => { m.user.current = seller(); });

  it('nunca mostra SellerPicker — autoatribuído', () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    expect(screen.queryByText('Selecione o vendedor…')).toBeNull();
  });

  it('confirmar chama createTask com actorRole seller, SEM assignedSellerId', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(createTaskSpy).toHaveBeenCalledTimes(1));
    const call = createTaskSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('seller');
    expect(call).not.toHaveProperty('assignedSellerId');
  });
});

describe('FlowFollowUp — proteção de dupla submissão', () => {
  it('desabilita o botão enquanto isPending, nunca chama createTask duas vezes', async () => {
    m.useCreateTask.mockImplementation(() => createHookResult(createTaskSpy, { isPending: true }));
    renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Criando…'));
    fireEvent.click(screen.getByText('Criando…'));
    expect(createTaskSpy).not.toHaveBeenCalled();
  });
});

describe('FlowFollowUp — identity_changed fecha o flow sem mostrar erro', () => {
  it('fecha diretamente, nunca mostra a mensagem de erro', async () => {
    const { RemoteTasksError } = await import('@/lib/tasks/errors');
    createTaskSpy = vi.fn().mockRejectedValue(new RemoteTasksError('remote_tasks_mutation_identity_changed'));
    m.useCreateTask.mockImplementation(() => createHookResult(createTaskSpy));
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Cliente pediu para pensar'));
    fireEvent.click(screen.getByText('Criar pendência'));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
