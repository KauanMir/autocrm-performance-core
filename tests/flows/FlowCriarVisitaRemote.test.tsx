// Testes de FlowCriarVisita — cutover de criação remota (COMMERCIAL-
// REMOTE-VISITS-B4). useCreateVisit/useCurrentCompanyAssignableSellers/
// useRemoteLeadsScreenState/resolveVisitRemoteMode são mockados
// diretamente no nível do componente — mesmo padrão de
// tests/flows/FlowNovaPendenciaRemote.test.tsx (evita QueryClientProvider
// real; a integração completa da mutation já está coberta em
// tests/hooks/useCreateVisit.test.tsx). O caminho LOCAL (VisitService.
// create) já tinha cobertura própria — reexercitado aqui só para provar
// que continua intacto.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteVisitsError } from '@/lib/visits/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  resolveVisitRemoteMode: vi.fn(),
  useCreateVisit: vi.fn(),
  useCurrentCompanyAssignableSellers: vi.fn(),
  useRemoteLeadsScreenState: vi.fn(),
  visitServiceCreate: vi.fn(),
  leadServiceGetAll: vi.fn(() => [] as any[]),
  leadServiceAddToTimeline: vi.fn(),
  leadServiceUpdateHealth: vi.fn(),
}));

vi.mock('@/lib/visits/remoteVisitsMode', () => ({
  resolveVisitRemoteMode: m.resolveVisitRemoteMode,
}));
vi.mock('@/lib/hooks/useCreateVisit', () => ({
  useCreateVisit: m.useCreateVisit,
}));
vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({
  useCurrentCompanyAssignableSellers: m.useCurrentCompanyAssignableSellers,
}));
vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: {
    getAll: m.leadServiceGetAll,
    addToTimeline: m.leadServiceAddToTimeline,
    updateHealth: m.leadServiceUpdateHealth,
  },
  VisitService: { getAll: () => [], create: m.visitServiceCreate },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowCriarVisita } from '@/components/flows/Flows2';

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

function createHookResult(createVisit: any, over: Partial<Record<string, unknown>> = {}) {
  return { createVisit, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function assignableSellersResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    assignableSellers: [{ seller_id: 's1', name: 'Ana Assignable' }],
    sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}
function remoteLead(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-1', name: 'Cliente Remoto', phone: '11999990000', car: 'Onix', stage: 'Novo', seller: 'Vendedor Um',
    sellerId: 's1', urgency: 'green', last: '-', alert: '-', pay: '-', value: '-',
    stageId: 'stage-1', stageCode: 'novo', valueAmount: null, archivedAt: null, version: 1,
    createdAt: '2026-08-01T00:00:00Z', createdByUserId: null, updatedAt: '2026-08-01T00:00:00Z', updatedByProfileId: null,
    ...over,
  };
}
function leadsScreenResult(leads: any[] = [], over: Partial<Record<string, unknown>> = {}) {
  return {
    mode: 'remote_active',
    pipeline: {},
    sellerLabels: {},
    leads: {
      remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
      leads, isLoading: false, isFetching: false, isError: false, error: null, configError: null,
      isEmpty: leads.length === 0, hasData: leads.length > 0, refetch: vi.fn(),
      ...over,
    },
  };
}

let createVisitSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any = {}) {
  const close = vi.fn();
  const openFlow = vi.fn();
  render(<FlowCriarVisita payload={payload} close={close} openFlow={openFlow} />);
  return { close, openFlow };
}

function fillWhenRemote(when: string, opts: { date?: string; time?: string } = {}) {
  fireEvent.click(screen.getByText(when));
  if (opts.date !== undefined) fireEvent.change(screen.getByLabelText('Data'), { target: { value: opts.date } });
  if (opts.time !== undefined) fireEvent.click(screen.getByText(opts.time));
}

function pickVehicle(name: string) {
  fireEvent.click(screen.getByText(name));
}

beforeEach(() => {
  m.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_local');
  m.visitServiceCreate.mockReset();
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.leadServiceAddToTimeline.mockReset();
  m.leadServiceUpdateHealth.mockReset();
  createVisitSpy = vi.fn().mockResolvedValue({});
  m.useCreateVisit.mockReset().mockImplementation(() => createHookResult(createVisitSpy));
  m.useCurrentCompanyAssignableSellers.mockReset().mockImplementation(() => assignableSellersResult());
  m.useRemoteLeadsScreenState.mockReset().mockImplementation(() => leadsScreenResult([]));
  m.user.current = manager();
});

describe('FlowCriarVisita — visit_local (preservado)', () => {
  it('cria localmente com o payload de sempre, createVisit remoto 0 calls', () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente pelo nome...'), { target: { value: 'Juliana' } });
    pickVehicle('Golf GTI 2022');
    fireEvent.click(screen.getByText('Amanhã'));
    fireEvent.click(screen.getByText('10:30'));
    fireEvent.click(screen.getByText('Agendar visita'));

    expect(m.visitServiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      client: 'Juliana',
      car: 'Golf GTI 2022',
      day: 'amanha',
      time: '10:30',
      status: 'agendada',
      leadId: null,
    }));
    expect(createVisitSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Visita agendada!')).toBeInTheDocument();
  });
});

describe('FlowCriarVisita — remote Manager, standalone', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
  });

  it('mostra RemoteLeadPicker + SellerPicker remoto (assignable), nunca LeadService/SellerService local', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    expect(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...')).toBeInTheDocument();
    expect(screen.getByText('Selecione o vendedor…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('cria standalone: {actorRole:"manager", leadId:null, clientName, assignedSellerId, scheduledAt, vehicles}', async () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fillWhenRemote('Hoje', { time: '14:00' });

    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const call = createVisitSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('manager');
    expect(call.leadId).toBeNull();
    expect(call.clientName).toBe('Cliente Avulso');
    expect(call.assignedSellerId).toBe('s1');
    expect(call.vehicles).toEqual(['Golf GTI 2022']);
    expect(m.visitServiceCreate).not.toHaveBeenCalled();
  });

  it('sem cliente/lead: createVisit 0 calls', () => {
    renderFlow();
    pickVehicle('Golf GTI 2022');
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    expect(createVisitSpy).not.toHaveBeenCalled();
  });

  it('sem vendedor selecionado (standalone): createVisit 0 calls', () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    expect(createVisitSpy).not.toHaveBeenCalled();
  });

  it('sem veículo: createVisit 0 calls', () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    expect(createVisitSpy).not.toHaveBeenCalled();
  });
});

describe('FlowCriarVisita — remote Manager + Lead', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
  });

  it('selecionar Lead com seller assignable pré-seleciona o Seller como default', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ sellerId: 's1' })]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente' } });
    fireEvent.click(screen.getByText('Cliente Remoto'));
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();
  });

  it('Lead sem seller (ou não assignable): Seller fica vazio, picker obrigatório', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ sellerId: 's-nao-assignable' })]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente' } });
    fireEvent.click(screen.getByText('Cliente Remoto'));
    expect(screen.getByText('Selecione o vendedor…')).toBeInTheDocument();
  });

  it('cria vinculado ao Lead: leadId correto, clientName omitido, vehicle pré-preenchido do Lead', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ id: 'lead-99', car: 'Toyota Corolla 2023', sellerId: 's1' })]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente' } });
    fireEvent.click(screen.getByText('Cliente Remoto'));
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const call = createVisitSpy.mock.calls[0][0];
    expect(call.leadId).toBe('lead-99');
    expect(call.clientName).toBeUndefined();
    expect(call.vehicles).toEqual(['Toyota Corolla 2023']);
    expect(call.assignedSellerId).toBe('s1');
  });

  it('trocar de Lead A (com seller) para Lead B (sem seller assignable) recalcula e limpa o Seller', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([
      remoteLead({ id: 'lead-a', name: 'Lead A', sellerId: 's1' }),
      remoteLead({ id: 'lead-b', name: 'Lead B', sellerId: 's-nao-assignable' }),
    ]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByText('Lead A'));
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Trocar cliente'));
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByText('Lead B'));
    expect(screen.getByText('Selecione o vendedor…')).toBeInTheDocument();
  });

  it('limpar o Lead (voltar a standalone) mantém o Seller já selecionado', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ sellerId: 's1' })]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente' } });
    fireEvent.click(screen.getByText('Cliente Remoto'));
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Trocar cliente'));
    // Seller continua "Ana Assignable" (mantido), não volta a "Selecione o vendedor…".
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Standalone' } });
    pickVehicle('Golf GTI 2022');
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());
    expect(createVisitSpy.mock.calls[0][0].leadId).toBeNull();
    expect(createVisitSpy.mock.calls[0][0].assignedSellerId).toBe('s1');
  });

  it('Lead arquivado/ausente não aparece no picker (snapshot já filtra) — sem fallback local', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Qualquer' } });
    expect(screen.queryByText('Cliente Remoto')).toBeNull();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });
});

describe('FlowCriarVisita — remote Seller', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    m.user.current = seller();
  });

  it('sem picker de vendedor; createVisit recebe actorRole:"seller" sem assignedSellerId', async () => {
    renderFlow();
    expect(screen.queryByText('Selecione o vendedor…')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    // 'Amanhã' (não 'Hoje') — resolveRemoteVisitScheduledAt usa a data de
    // amanhã para qualquer slot fixo, então o resultado é sempre futuro
    // relativo ao relógio real do runner, em qualquer hora do dia (achado
    // do B7-0-TEST-CLOCK-FIX: 'Hoje'+'09:00' ficava no passado depois das
    // 09:00 locais). O dia agendado não é asserted por este teste — só
    // actorRole/assignedSellerId.
    fillWhenRemote('Amanhã', { time: '09:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const call = createVisitSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('seller');
    expect('assignedSellerId' in call).toBe(false);
  });

  it('pode selecionar Lead — leadId correto, ainda sem assignedSellerId', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ id: 'lead-seller-1', sellerId: 'outro-vendedor' })]));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente' } });
    fireEvent.click(screen.getByText('Cliente Remoto'));
    // 'Amanhã' pelo mesmo motivo do teste acima (B7-0-TEST-CLOCK-FIX).
    fillWhenRemote('Amanhã', { time: '09:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const call = createVisitSpy.mock.calls[0][0];
    expect(call.leadId).toBe('lead-seller-1');
    expect('assignedSellerId' in call).toBe(false);
  });
});

describe('FlowCriarVisita — data/hora remota', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
  });

  function fillMinimum() {
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana Assignable'));
  }

  it('Hoje -> scheduledAt no dia local de hoje, no horário escolhido', async () => {
    const now = new Date();
    renderFlow();
    fillMinimum();
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const scheduledAt = new Date(createVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getFullYear()).toBe(now.getFullYear());
    expect(scheduledAt.getMonth()).toBe(now.getMonth());
    expect(scheduledAt.getDate()).toBe(now.getDate());
    expect(scheduledAt.getHours()).toBe(14);
  });

  it('Amanhã -> próximo dia de calendário local', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    renderFlow();
    fillMinimum();
    fillWhenRemote('Amanhã', { time: '17:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const scheduledAt = new Date(createVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getFullYear()).toBe(tomorrow.getFullYear());
    expect(scheduledAt.getMonth()).toBe(tomorrow.getMonth());
    expect(scheduledAt.getDate()).toBe(tomorrow.getDate());
    expect(scheduledAt.getHours()).toBe(17);
  });

  it('Personalizado com data futura -> scheduledAt correto', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureYMD = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    renderFlow();
    fillMinimum();
    fillWhenRemote('Personalizado', { date: futureYMD, time: '10:30' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    const scheduledAt = new Date(createVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getFullYear()).toBe(future.getFullYear());
    expect(scheduledAt.getMonth()).toBe(future.getMonth());
    expect(scheduledAt.getDate()).toBe(future.getDate());
    expect(scheduledAt.getHours()).toBe(10);
    expect(scheduledAt.getMinutes()).toBe(30);
  });

  it('data/hora ausente: createVisit 0 calls', () => {
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Agendar visita'));
    expect(createVisitSpy).not.toHaveBeenCalled();
  });

  it('Personalizado com data no passado: createVisit 0 calls, mensagem exibida', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const pastYMD = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
    renderFlow();
    fillMinimum();
    fillWhenRemote('Personalizado', { date: pastYMD, time: '10:30' });
    fireEvent.click(screen.getByText('Agendar visita'));
    expect(createVisitSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Escolha uma data e horário futuros.')).toBeInTheDocument();
  });
});

describe('FlowCriarVisita — veículos', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
  });

  it('múltiplos veículos + "outro veículo" -> vehicles trimmed, sem vazios', async () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    pickVehicle('Honda HR-V 2023');
    fireEvent.change(screen.getByPlaceholderText('Cliente também quer ver...'), { target: { value: '  Fusca 1978  ' } });
    fireEvent.click(screen.getByText('Selecione o vendedor…'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fillWhenRemote('Hoje', { time: '14:00' });
    fireEvent.click(screen.getByText('Agendar visita'));
    await waitFor(() => expect(createVisitSpy).toHaveBeenCalled());

    expect(createVisitSpy.mock.calls[0][0].vehicles).toEqual(['Golf GTI 2022', 'Honda HR-V 2023', 'Fusca 1978']);
  });
});

describe('FlowCriarVisita — pending/double-submit', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    m.user.current = seller();
  });

  it('isPending=true: clique não gera segunda chamada', () => {
    m.useCreateVisit.mockImplementation(() => createHookResult(createVisitSpy, { isPending: true }));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    // 'Amanhã' (não 'Hoje') — mesmo motivo do B7-0-TEST-CLOCK-FIX: qualquer
    // slot fixo em 'Amanhã' é sempre futuro relativo ao relógio real do
    // runner, em qualquer hora do dia. Nenhum destes testes asserta o dia
    // agendado.
    fillWhenRemote('Amanhã', { time: '10:30' });

    expect(screen.getByText('Agendando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Agendando…'));
    expect(createVisitSpy).not.toHaveBeenCalled();
  });
});

describe('FlowCriarVisita — sucesso remoto', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    m.user.current = seller();
  });

  it('FlowSuccess só aparece depois do resolve; VisitService/LeadService nunca chamados', async () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    // 'Amanhã' (não 'Hoje') — mesmo motivo do B7-0-TEST-CLOCK-FIX: qualquer
    // slot fixo em 'Amanhã' é sempre futuro relativo ao relógio real do
    // runner, em qualquer hora do dia. Nenhum destes testes asserta o dia
    // agendado.
    fillWhenRemote('Amanhã', { time: '10:30' });
    fireEvent.click(screen.getByText('Agendar visita'));

    expect(screen.queryByText('Visita agendada!')).toBeNull();
    await waitFor(() => expect(screen.getByText('Visita agendada!')).toBeInTheDocument());
    expect(m.visitServiceCreate).not.toHaveBeenCalled();
    expect(m.leadServiceAddToTimeline).not.toHaveBeenCalled();
    expect(m.leadServiceUpdateHealth).not.toHaveBeenCalled();
  });
});

describe.each([
  ['forbidden', 'remote_visits_mutation_forbidden', 'Você não tem permissão para agendar esta visita.'],
  ['seller_required', 'remote_visits_mutation_seller_required', 'Selecione um vendedor responsável.'],
  ['seller_not_found', 'remote_visits_mutation_seller_not_found', 'O vendedor selecionado não está mais disponível.'],
  ['lead_not_found', 'remote_visits_mutation_lead_not_found', 'O cliente selecionado não está mais disponível.'],
  ['lead_archived', 'remote_visits_mutation_lead_archived', 'Não é possível agendar uma nova visita para um cliente arquivado.'],
  ['client_name_required', 'remote_visits_mutation_client_name_required', 'Informe o nome do cliente.'],
  ['invalid_vehicles', 'remote_visits_mutation_invalid_vehicles', 'Informe pelo menos um veículo válido.'],
  ['generic', 'remote_visits_mutation_generic_error', 'Não foi possível agendar a visita. Tente novamente.'],
] as const)('FlowCriarVisita — erro %s', (_label, code, expectedMessage) => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    m.user.current = seller();
  });

  it(`mostra "${expectedMessage}", nunca FlowSuccess, nunca VisitService.create`, async () => {
    createVisitSpy.mockRejectedValueOnce(new RemoteVisitsError(code as any, { operation: 'create_visit' }));
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    // 'Amanhã' (não 'Hoje') — mesmo motivo do B7-0-TEST-CLOCK-FIX: qualquer
    // slot fixo em 'Amanhã' é sempre futuro relativo ao relógio real do
    // runner, em qualquer hora do dia. Nenhum destes testes asserta o dia
    // agendado.
    fillWhenRemote('Amanhã', { time: '10:30' });
    fireEvent.click(screen.getByText('Agendar visita'));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(m.visitServiceCreate).not.toHaveBeenCalled();
    expect(screen.queryByText('Visita agendada!')).toBeNull();
  });
});

describe('FlowCriarVisita — identity_changed', () => {
  beforeEach(() => {
    m.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    m.user.current = seller();
  });

  it('fecha o flow, nenhuma mensagem de erro, nenhum FlowSuccess', async () => {
    createVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'create_visit' }));
    const { close } = renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente existente ou digitar o nome de um cliente avulso...'), { target: { value: 'Cliente Avulso' } });
    pickVehicle('Golf GTI 2022');
    // 'Amanhã' (não 'Hoje') — mesmo motivo do B7-0-TEST-CLOCK-FIX: qualquer
    // slot fixo em 'Amanhã' é sempre futuro relativo ao relógio real do
    // runner, em qualquer hora do dia. Nenhum destes testes asserta o dia
    // agendado.
    fillWhenRemote('Amanhã', { time: '10:30' });
    fireEvent.click(screen.getByText('Agendar visita'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Visita agendada!')).toBeNull();
  });
});
