// Testes de FlowNovaProposta — cutover de criação remota (COMMERCIAL-
// REMOTE-DEALS-B4). useCreateDeal/useCurrentCompanyAssignableSellers/
// useRemoteLeadsScreenState/resolveDealRemoteMode são mockados diretamente
// no nível do componente — mesmo padrão exato de
// tests/flows/FlowCriarVisitaRemote.test.tsx (evita QueryClientProvider
// real; a integração completa da mutation já está coberta em
// tests/hooks/useCreateDeal.test.tsx). O caminho LOCAL (DealService.create)
// já tinha cobertura indireta — reexercitado aqui diretamente para provar
// que continua byte-idêntico (nenhum outro arquivo de teste renderiza
// FlowNovaProposta diretamente).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteDealsError } from '@/lib/deals/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  resolveDealRemoteMode: vi.fn(),
  useCreateDeal: vi.fn(),
  useCurrentCompanyAssignableSellers: vi.fn(),
  useRemoteLeadsScreenState: vi.fn(),
  dealServiceCreate: vi.fn(),
  leadServiceGetAll: vi.fn(() => [] as any[]),
  leadServiceAddToTimeline: vi.fn(),
  leadServiceUpdateHealth: vi.fn(),
}));

vi.mock('@/lib/deals/remoteDealsMode', () => ({
  resolveDealRemoteMode: m.resolveDealRemoteMode,
}));
vi.mock('@/lib/hooks/useCreateDeal', () => ({
  useCreateDeal: m.useCreateDeal,
}));
vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({
  useCurrentCompanyAssignableSellers: m.useCurrentCompanyAssignableSellers,
}));
vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.user.current?.activeMembership?.role === 'manager' },
  LeadService: {
    getAll: m.leadServiceGetAll,
    addToTimeline: m.leadServiceAddToTimeline,
    updateHealth: m.leadServiceUpdateHealth,
  },
  DealService: { getAll: () => [], create: m.dealServiceCreate },
  VisitService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowNovaProposta } from '@/components/flows/Flows2';

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

function createHookResult(createDeal: any, over: Partial<Record<string, unknown>> = {}) {
  return { createDeal, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
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

let createDealSpy: ReturnType<typeof vi.fn>;
const CREATED = { id: 'deal-1', lead_id: 'lead-1', client_name_snapshot: 'Cliente Remoto', status: 'open' };

function renderFlow(payload: any = {}) {
  const close = vi.fn();
  const openFlow = vi.fn();
  render(<FlowNovaProposta payload={payload} close={close} openFlow={openFlow} />);
  return { close, openFlow };
}

function pickRemoteLead(query = 'Cliente', name = 'Cliente Remoto') {
  fireEvent.change(screen.getByPlaceholderText('Buscar cliente pelo nome ou telefone...'), { target: { value: query } });
  fireEvent.click(screen.getByText(name));
}
function fillVehicle(value = 'Onix Premier 2025') {
  fireEvent.change(screen.getByLabelText('Veículo'), { target: { value } });
}
function fillValue(value = '120000') {
  fireEvent.change(screen.getByLabelText('Valor negociado (R$)'), { target: { value } });
}
function pickPayment(label: string) {
  fireEvent.click(screen.getByText(label));
}
function fillMinimum() {
  pickRemoteLead();
  fillVehicle();
  fillValue();
  pickPayment('À vista');
}

beforeEach(() => {
  m.resolveDealRemoteMode.mockReset().mockReturnValue('deal_local');
  m.dealServiceCreate.mockReset();
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.leadServiceAddToTimeline.mockReset();
  m.leadServiceUpdateHealth.mockReset();
  createDealSpy = vi.fn().mockResolvedValue(CREATED);
  m.useCreateDeal.mockReset().mockImplementation(() => createHookResult(createDealSpy));
  m.useCurrentCompanyAssignableSellers.mockReset().mockImplementation(() => assignableSellersResult());
  m.useRemoteLeadsScreenState.mockReset().mockImplementation(() => leadsScreenResult([]));
  m.user.current = manager();
});

describe('FlowNovaProposta — deal_local (preservado)', () => {
  it('cria localmente com o payload de sempre, createDeal remoto 0 calls', () => {
    m.leadServiceGetAll.mockReturnValue([{ id: 'l1', name: 'Ana Paula', car: 'Onix', pay: 'À vista', value: 'R$ 90.000', seller: 'Marcos Silva', sellerId: 's1', urgency: 'green' }]);
    renderFlow();

    // Passo 0: selecionar Lead local (LeadPicker), aceitar veículo default.
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente pelo nome...'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByText('Ana Paula'));
    fireEvent.click(screen.getByText('Continuar'));
    // Passo 1: aceitar condições default.
    fireEvent.click(screen.getByText('Continuar'));
    // Passo 2: criar.
    fireEvent.click(screen.getByText('Criar proposta'));

    expect(m.dealServiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      client: 'Ana Paula',
      leadId: 'l1',
    }));
    expect(screen.getByText('Proposta enviada!')).toBeInTheDocument();
    expect(createDealSpy).not.toHaveBeenCalled();
    // COMMERCIAL-REMOTE-DEALS-B7-A: CTA remoto nunca introduzido no
    // success local — "Enviar ao cliente"/"Concluir" continuam os únicos
    // botões, exatamente como antes do B7-A.
    expect(screen.queryByText('Agendar acompanhamento')).toBeNull();
  });
});

describe('FlowNovaProposta — remote Manager', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('mostra RemoteLeadPicker + SellerPicker opcional, nunca LeadService/DealService local', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    expect(screen.getByPlaceholderText('Buscar cliente pelo nome ou telefone...')).toBeInTheDocument();
    expect(screen.getByText('Vendedor responsável')).toBeInTheDocument();
    expect(screen.getByText('Deixar em aberto (usar responsável do cliente)')).toBeInTheDocument();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('Lead ausente: bloqueia submit, createDeal 0 calls', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillVehicle();
    fillValue();
    pickPayment('À vista');
    fireEvent.click(screen.getByText('Criar negociação'));
    expect(createDealSpy).not.toHaveBeenCalled();
  });

  it('CRÍTICO — Valor vazio: bloqueia submit, NUNCA produz 12000000 cents (fallback comercial proibido)', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    pickRemoteLead();
    fillVehicle();
    pickPayment('À vista');
    // remoteValueInput permanece '' — nunca preenchido.
    fireEvent.click(screen.getByText('Criar negociação'));
    expect(createDealSpy).not.toHaveBeenCalled();
  });

  it('Veículo vazio: bloqueia submit, createDeal 0 calls', () => {
    // Lead sem car: pickRemoteDealLead só prefila o veículo quando o Lead
    // tem um (l.car truthy) — usar um Lead sem car garante o campo
    // realmente vazio, em vez de depender de limpar um valor prefilled.
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ car: '' })]));
    renderFlow();
    pickRemoteLead();
    fillValue();
    pickPayment('À vista');
    fireEvent.click(screen.getByText('Criar negociação'));
    expect(createDealSpy).not.toHaveBeenCalled();
  });

  it('Forma de pagamento não escolhida: bloqueia submit, createDeal 0 calls', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    pickRemoteLead();
    fillVehicle();
    fillValue();
    fireEvent.click(screen.getByText('Criar negociação'));
    expect(createDealSpy).not.toHaveBeenCalled();
  });

  it('cria negociação: payload exato com valueCents corretos, sem assignedSellerId quando não escolhido', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());

    const call = createDealSpy.mock.calls[0][0];
    expect(call).toEqual({
      actorRole: 'manager',
      leadId: 'lead-1',
      vehicle: 'Onix Premier 2025',
      valueCents: 12000000,
      discountPercent: 0,
      paymentMethod: 'a_vista',
      downPaymentCents: null,
      installments: null,
      note: '',
      assignedSellerId: null,
    });
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['À vista', 'a_vista'],
    ['Financiamento 100%', 'financiamento_100'],
    ['Entrada + Financiamento', 'entrada_financiamento'],
    ['Troca', 'troca'],
  ] as const)('forma de pagamento "%s" -> enum "%s"', async (label, enumValue) => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    pickRemoteLead();
    fillVehicle();
    fillValue();
    pickPayment(label);
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());
    expect(createDealSpy.mock.calls[0][0].paymentMethod).toBe(enumValue);
  });

  it('entrada_financiamento revela Entrada + Parcelas; financiamento_100 revela só Parcelas; a_vista/troca escondem ambos', () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();

    pickPayment('Entrada + Financiamento');
    expect(screen.getByLabelText('Entrada (R$)')).toBeInTheDocument();
    expect(screen.getByLabelText('Parcelas / condição')).toBeInTheDocument();

    pickPayment('Financiamento 100%');
    expect(screen.queryByLabelText('Entrada (R$)')).toBeNull();
    expect(screen.getByLabelText('Parcelas / condição')).toBeInTheDocument();

    pickPayment('À vista');
    expect(screen.queryByLabelText('Entrada (R$)')).toBeNull();
    expect(screen.queryByLabelText('Parcelas / condição')).toBeNull();

    pickPayment('Troca');
    expect(screen.queryByLabelText('Entrada (R$)')).toBeNull();
    expect(screen.queryByLabelText('Parcelas / condição')).toBeNull();
  });

  it('valores ocultos não sobrevivem no payload após trocar forma de pagamento', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    pickRemoteLead();
    fillVehicle();
    fillValue();
    pickPayment('Entrada + Financiamento');
    fireEvent.change(screen.getByLabelText('Entrada (R$)'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('Parcelas / condição'), { target: { value: '48x de R$ 2.100' } });
    pickPayment('À vista');
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());

    const call = createDealSpy.mock.calls[0][0];
    expect(call.downPaymentCents).toBeNull();
    expect(call.installments).toBeNull();
  });

  it('desconto: oculto e 0 por padrão sem interação; "Aplicar desconto" revela o slider', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    expect(screen.queryByText('Desconto aplicado')).toBeNull();

    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());
    expect(createDealSpy.mock.calls[0][0].discountPercent).toBe(0);
  });

  it('desconto: "Aplicar desconto" revela slider, alteração reflete no payload', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Aplicar desconto'));
    expect(screen.getByText('Desconto aplicado')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());
    expect(createDealSpy.mock.calls[0][0].discountPercent).toBe(5);
    // Nenhum texto de aprovação sobrevive no branch remoto.
    expect(screen.queryByText(/aprovação/i)).toBeNull();
  });

  it('observação opcional: em branco permitida, texto enviado trimmed', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.change(screen.getByPlaceholderText('Comentário interno sobre a negociação...'), { target: { value: '  Cliente quer entrega rápida  ' } });
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());
    expect(createDealSpy.mock.calls[0][0].note).toBe('Cliente quer entrega rápida');
  });

  it('Manager pode selecionar vendedor responsável explicitamente', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Deixar em aberto (usar responsável do cliente)'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());
    expect(createDealSpy.mock.calls[0][0].assignedSellerId).toBe('s1');
  });

  it('sucesso: mostra "Negociação criada!", Concluir fecha o flow', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    const { close } = renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  // COMMERCIAL-REMOTE-DEALS-B7-A — CTA opcional de acompanhamento.
  it('sucesso: "Agendar acompanhamento" presente junto de "Concluir", opcional (Concluir direto não cria Task)', async () => {
    const lead = remoteLead();
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([lead]));
    const { close } = renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());

    expect(screen.getByText('Agendar acompanhamento')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  it('"Agendar acompanhamento": abre nova-pendencia com {lead: remoteSelectedLead}, zero dealId no payload', async () => {
    const lead = remoteLead();
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([lead]));
    const { openFlow } = renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Agendar acompanhamento'));
    expect(openFlow).toHaveBeenCalledWith('nova-pendencia', { lead });
    const payload = openFlow.mock.calls.find((call) => call[0] === 'nova-pendencia')![1];
    expect(Object.keys(payload)).toEqual(['lead']);
  });

  it('double-submit: clique repetido não gera segunda chamada', async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    createDealSpy.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    fireEvent.click(screen.getByText('Criando…'));
    fireEvent.click(screen.getByText('Criando…'));
    resolveCreate(CREATED);
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());
    expect(createDealSpy).toHaveBeenCalledTimes(1);
  });
});

// COMMERCIAL-REMOTE-DEALS-B6 — payload.vehicle é a autoridade da ponte
// Visits→Negociações sobre o fallback remoteSelectedLead?.car
// (B6-PRECHECK §11/§42). Abertura normal (sem a propriedade `vehicle`
// no payload, como toda abertura via CTA/ScreenPropostas) precisa
// continuar preenchendo o campo a partir do car do Lead — regressão do
// B4, nunca quebrada pela distinção nova.
describe('FlowNovaProposta — prefill de veículo via payload (ponte B6)', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('sem propriedade payload.vehicle: prefill normal a partir do car do Lead (regressão B4)', () => {
    const lead = remoteLead({ car: 'HB20' });
    renderFlow({ lead });
    expect((screen.getByLabelText('Veículo') as HTMLInputElement).value).toBe('HB20');
  });

  it('payload.vehicle explicitamente vazio: campo Veículo vazio, NUNCA cai no car do Lead', () => {
    const lead = remoteLead({ car: 'HB20' });
    renderFlow({ lead, vehicle: '' });
    expect((screen.getByLabelText('Veículo') as HTMLInputElement).value).toBe('');
  });

  it('payload.vehicle explícito (não vazio): usado como prefill, tem prioridade sobre o car do Lead', () => {
    const lead = remoteLead({ car: 'HB20' });
    renderFlow({ lead, vehicle: 'Onix Premier' });
    expect((screen.getByLabelText('Veículo') as HTMLInputElement).value).toBe('Onix Premier');
  });
});

describe('FlowNovaProposta — remote Seller', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    m.user.current = seller();
  });

  it('sem picker de vendedor; createDeal recebe actorRole:"seller" sem assignedSellerId', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    expect(screen.queryByText('Vendedor responsável')).toBeNull();

    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(createDealSpy).toHaveBeenCalled());

    const call = createDealSpy.mock.calls[0][0];
    expect(call.actorRole).toBe('seller');
    expect('assignedSellerId' in call).toBe(false);
  });
});

describe.each([
  ['forbidden', 'remote_deals_mutation_forbidden', 'Você não tem permissão para alterar esta negociação.'],
  ['invalid_vehicle', 'remote_deals_mutation_invalid_vehicle', 'Informe um veículo válido.'],
  ['invalid_value', 'remote_deals_mutation_invalid_value', 'Informe um valor válido.'],
  ['invalid_discount', 'remote_deals_mutation_invalid_discount', 'O desconto precisa estar entre 0% e 10%.'],
  ['lead_not_found', 'remote_deals_mutation_lead_not_found', 'O cliente vinculado não está disponível.'],
  ['lead_archived', 'remote_deals_mutation_lead_archived', 'Este cliente já foi arquivado.'],
  ['seller_required', 'remote_deals_mutation_seller_required', 'Selecione um vendedor responsável.'],
  ['seller_not_found', 'remote_deals_mutation_seller_not_found', 'O vendedor selecionado não está disponível.'],
  ['generic', 'remote_deals_mutation_generic_error', 'Não foi possível concluir a ação. Tente novamente.'],
] as const)('FlowNovaProposta — erro %s', (_label, code, expectedMessage) => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it(`mostra "${expectedMessage}", nunca fecha o form, zero DealService/LeadService local`, async () => {
    createDealSpy.mockRejectedValue(new RemoteDealsError(code as any));
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));

    await waitFor(() => expect(screen.getByText(expectedMessage)).toBeInTheDocument());
    expect(screen.queryByText('Negociação criada!')).toBeNull();
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });
});

// COMMERCIAL-REMOTE-DEALS-B8-R1 — bug real encontrado no smoke autenticado
// (B8-SMOKE-EXEC): SellerPicker ficava permanentemente desabilitado após
// seller_required/seller_not_found (isDisabled incluía `error`), forçando
// o Manager a fechar/reabrir o flow inteiro para corrigir o vendedor.
// Regressão: erro aparece, picker continua clicável, Manager corrige e
// reenvia SEM fechar o formulário — sucesso na segunda tentativa.
describe('FlowNovaProposta — SellerPicker reabilitado após erro de validação (B8-R1)', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('seller_required: erro aparece, picker continua interativo, corrigir e reenviar tem sucesso', async () => {
    createDealSpy.mockRejectedValueOnce(new RemoteDealsError('remote_deals_mutation_seller_required'));
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Selecione um vendedor responsável.')).toBeInTheDocument());

    // Corrige sem fechar/reabrir o flow: clica no próprio trigger (que
    // agora mostra a mensagem de erro) e escolhe um vendedor válido.
    fireEvent.click(screen.getByText('Selecione um vendedor responsável.'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    // Selecionar já limpa a mensagem antiga — nunca fica parecendo válida.
    expect(screen.queryByText('Selecione um vendedor responsável.')).toBeNull();

    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());
    expect(createDealSpy).toHaveBeenCalledTimes(2);
    expect(createDealSpy.mock.calls[1][0].assignedSellerId).toBe('s1');
  });

  it('seller_not_found: erro aparece, picker reabilitado, Manager escolhe outro vendedor e reenvia com sucesso', async () => {
    createDealSpy.mockRejectedValueOnce(new RemoteDealsError('remote_deals_mutation_seller_not_found'));
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Deixar em aberto (usar responsável do cliente)'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('O vendedor selecionado não está disponível.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('O vendedor selecionado não está disponível.'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fireEvent.click(screen.getByText('Criar negociação'));
    await waitFor(() => expect(screen.getByText('Negociação criada!')).toBeInTheDocument());
    expect(createDealSpy).toHaveBeenCalledTimes(2);
  });
});

describe('FlowNovaProposta — identity_changed', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('fecha o flow, nenhuma mensagem de erro, nenhuma tela de sucesso', async () => {
    createDealSpy.mockRejectedValue(new RemoteDealsError('remote_deals_mutation_identity_changed'));
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    const { close } = renderFlow();
    fillMinimum();
    fireEvent.click(screen.getByText('Criar negociação'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Negociação criada!')).toBeNull();
  });
});
