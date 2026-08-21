// Testes de FlowRegistrarResultadoRemoto — cutover de registro remoto de
// resultado (COMMERCIAL-REMOTE-VISITS-B6-B) + ponte Visits→Negociações
// (COMMERCIAL-REMOTE-DEALS-B6). useRegisterVisitResult/
// useRemoteLeadsScreenState/resolveDealRemoteMode são mockados
// diretamente no nível do componente — mesmo padrão de
// tests/flows/FlowNovaPropostaRemote.test.tsx (evita QueryClientProvider
// real; a integração completa da mutation já está coberta em
// tests/hooks/useRegisterVisitResult.test.tsx). Este flow é REMOTE-ONLY
// (nenhum branch local): FlowRegistrarResultado local, intocada, continua
// abrindo registrar-venda/nova-proposta/criar-acompanhamento LOCAIS, fora
// do escopo deste arquivo.
//
// Regra absoluta preservada para sold/thinking/no_interest: NENHUM
// destino local (nem SaleService/DealService/TaskService/
// LeadService.updateHealth) é chamado a partir deste flow. `negotiating`
// deixou de ser absoluto no B6: a ponte para Nova negociação SÓ dispara
// quando resolveDealRemoteMode()==='deal_remote_ready' E o Lead da Visit
// é resolvido a partir do snapshot remoto já carregado — testado à
// exaustão nas suítes "ponte" abaixo. Por padrão (beforeEach),
// resolveDealRemoteMode retorna 'deal_local' e o snapshot de Leads vem
// vazio — todos os testes genéricos herdados do B6-B continuam
// corretos sem qualquer mudança de setup (a ponte nunca dispara sob o
// default).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteVisitsError } from '@/lib/visits/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  useRegisterVisitResult: vi.fn(),
  useRemoteLeadsScreenState: vi.fn(),
  resolveDealRemoteMode: vi.fn(),
  visitServiceUpdate: vi.fn(),
  leadServiceAddToTimeline: vi.fn(),
  leadServiceUpdateHealth: vi.fn(),
  saleServiceCreate: vi.fn(),
  dealServiceCreate: vi.fn(),
  taskServiceCreate: vi.fn(),
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useRegisterVisitResult', () => ({
  useRegisterVisitResult: m.useRegisterVisitResult,
}));
vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));
vi.mock('@/lib/deals/remoteDealsMode', () => ({
  resolveDealRemoteMode: m.resolveDealRemoteMode,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [], addToTimeline: m.leadServiceAddToTimeline, updateHealth: m.leadServiceUpdateHealth },
  VisitService: { getAll: () => [], create: vi.fn(), update: m.visitServiceUpdate },
  DealService: { getAll: () => [], create: m.dealServiceCreate },
  SaleService: { getAll: () => [], create: m.saleServiceCreate },
  TaskService: { getAll: () => [], create: m.taskServiceCreate, update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowRegistrarResultadoRemoto } from '@/components/flows/Flows2';

function manager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function registerHookResult(registerVisitResult: any, over: Partial<Record<string, unknown>> = {}) {
  return { registerVisitResult, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
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

function remoteLead(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-1', name: 'Cliente Remoto', phone: '11999990000', car: 'Onix', stage: 'Novo', seller: 'Vendedor Um',
    sellerId: 's1', urgency: 'green', last: '-', alert: '-', pay: '-', value: '-',
    stageId: 'stage-1', stageCode: 'novo', valueAmount: null, archivedAt: null, version: 1,
    createdAt: '2026-08-01T00:00:00Z', createdByUserId: null, updatedAt: '2026-08-01T00:00:00Z', updatedByProfileId: null,
    ...over,
  };
}

function remoteVisit(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'visit-1', clientName: 'Cliente Remoto', leadId: 'lead-1',
    assignedSellerId: 'seller-1', vehicles: ['Golf GTI 2022'], scheduledAt: '2020-01-01T14:00:00.000Z',
    status: 'scheduled', outcome: null, note: 'nota original', resultNote: null, version: 7,
    createdAt: '2019-12-01T10:00:00.000Z',
    ...over,
  };
}

let registerVisitResultSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any) {
  const close = vi.fn();
  render(<FlowRegistrarResultadoRemoto payload={payload} close={close} openFlow={m.openFlow} />);
  return { close };
}

function pickOutcome(title: string) {
  fireEvent.click(screen.getByText(title));
}
function submit() {
  fireEvent.click(screen.getByText('Salvar resultado'));
}

beforeEach(() => {
  m.visitServiceUpdate.mockReset();
  m.leadServiceAddToTimeline.mockReset();
  m.leadServiceUpdateHealth.mockReset();
  m.saleServiceCreate.mockReset();
  m.dealServiceCreate.mockReset();
  m.taskServiceCreate.mockReset();
  m.openFlow.mockReset();
  registerVisitResultSpy = vi.fn().mockResolvedValue({});
  m.useRegisterVisitResult.mockReset().mockImplementation(() => registerHookResult(registerVisitResultSpy));
  m.useRemoteLeadsScreenState.mockReset().mockImplementation(() => leadsScreenResult([]));
  m.resolveDealRemoteMode.mockReset().mockReturnValue('deal_local');
  m.user.current = manager();
});

describe('FlowRegistrarResultadoRemoto — sem Visit no payload', () => {
  it('payload.visit ausente: não renderiza nada, registerVisitResult 0 calls', () => {
    const { container } = render(<FlowRegistrarResultadoRemoto payload={{}} close={() => {}} openFlow={m.openFlow} />);
    expect(container).toBeEmptyDOMElement();
    expect(registerVisitResultSpy).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarResultadoRemoto — payload/version', () => {
  it('sem outcome selecionado: Salvar resultado não chama a mutation', () => {
    renderFlow({ visit: remoteVisit() });
    submit();
    expect(registerVisitResultSpy).not.toHaveBeenCalled();
  });

  it('registerVisitResult chamado com {visitId, expectedVersion, outcome, resultNote} exatos', async () => {
    renderFlow({ visit: remoteVisit({ id: 'visit-result-1', version: 5 }) });
    pickOutcome('Fechou negócio');
    fireEvent.change(screen.getByPlaceholderText('O que o cliente achou, objeções, próximos passos…'), { target: { value: '  Cliente gostou muito  ' } });
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalled());

    const call = registerVisitResultSpy.mock.calls[0][0];
    expect(call.visitId).toBe('visit-result-1');
    expect(call.expectedVersion).toBe(5);
    expect(call.outcome).toBe('sold');
    expect(call.resultNote).toBe('Cliente gostou muito');
  });

  it('sem observação: resultNote é string vazia, note original NUNCA enviado/alterado', async () => {
    renderFlow({ visit: remoteVisit({ note: 'nota original intacta' }) });
    pickOutcome('Sem interesse');
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalled());

    const call = registerVisitResultSpy.mock.calls[0][0];
    expect(call.resultNote).toBe('');
    expect('note' in call).toBe(false);
  });

  it('payload nunca contém status/Seller/Lead/clientName', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Em negociação');
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalled());

    const call = registerVisitResultSpy.mock.calls[0][0];
    expect('status' in call).toBe(false);
    expect('assignedSellerId' in call).toBe(false);
    expect('leadId' in call).toBe(false);
    expect('clientName' in call).toBe(false);
  });
});

describe.each([
  ['sold', 'Fechou negócio'],
  ['negotiating', 'Em negociação'],
  ['thinking', 'Vai pensar'],
  ['no_interest', 'Sem interesse'],
] as const)('FlowRegistrarResultadoRemoto — outcome %s', (outcomeValue, title) => {
  it(`selecionar "${title}" envia outcome:"${outcomeValue}"`, async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome(title);
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalled());
    expect(registerVisitResultSpy.mock.calls[0][0].outcome).toBe(outcomeValue);
  });
});

describe('FlowRegistrarResultadoRemoto — nenhum follow-up local (REGRA ABSOLUTA)', () => {
  it.each([
    ['sold', 'Fechou negócio'],
    ['negotiating', 'Em negociação'],
    ['thinking', 'Vai pensar'],
    ['no_interest', 'Sem interesse'],
  ] as const)('outcome %s: zero Sale/Deal/Task/health/timeline/openFlow de follow-up', async (_outcomeValue, title) => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome(title);
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalled());

    expect(m.saleServiceCreate).not.toHaveBeenCalled();
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
    expect(m.taskServiceCreate).not.toHaveBeenCalled();
    expect(m.leadServiceUpdateHealth).not.toHaveBeenCalled();
    expect(m.leadServiceAddToTimeline).not.toHaveBeenCalled();
    expect(m.visitServiceUpdate).not.toHaveBeenCalled();
    expect(m.openFlow).not.toHaveBeenCalledWith('registrar-venda', expect.anything());
    expect(m.openFlow).not.toHaveBeenCalledWith('nova-proposta', expect.anything());
    expect(m.openFlow).not.toHaveBeenCalledWith('criar-acompanhamento', expect.anything());
    expect(m.openFlow).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarResultadoRemoto — success UX por outcome', () => {
  it('sold: título "Fechou negócio", mensagem de continuidade de Venda adiada, botão Fechar apenas', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');
    submit();
    expect(await screen.findByText('Resultado registrado: Fechou negócio')).toBeInTheDocument();
    expect(screen.getByText(/continuidade para Venda será disponibilizada/)).toBeInTheDocument();
    expect(screen.getByText('Fechar')).toBeInTheDocument();
    expect(screen.queryByText('Registrar venda')).toBeNull();
  });

  it('negotiating (Deals ainda não pronto): título "Em negociação", sem mensagem de migração/flag/rollout', async () => {
    // COMMERCIAL-REMOTE-DEALS-B6: a antiga mensagem "será disponibilizada
    // após a migração deste módulo" foi removida de propósito para
    // negotiating (B6-PRECHECK §18) — Deals já migrou, só não está
    // remote-ready nesta sessão. Mesmo tratamento neutro de no_interest.
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Em negociação');
    submit();
    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(screen.queryByText(/será disponibilizad/)).toBeNull();
    expect(screen.queryByText(/migração|migration|flag|Supabase|rollout/i)).toBeNull();
    expect(screen.queryByText('Montar proposta')).toBeNull();
    expect(m.openFlow).not.toHaveBeenCalled();
  });

  it('thinking: título "Vai pensar", mensagem de continuidade de Acompanhamento adiada', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Vai pensar');
    submit();
    expect(await screen.findByText('Resultado registrado: Vai pensar')).toBeInTheDocument();
    expect(screen.getByText(/continuidade para Acompanhamento será disponibilizada/)).toBeInTheDocument();
    expect(screen.queryByText('Criar follow-up')).toBeNull();
  });

  it('no_interest: título "Sem interesse", nenhuma mensagem de módulo futuro desnecessária', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Sem interesse');
    submit();
    expect(await screen.findByText('Resultado registrado: Sem interesse')).toBeInTheDocument();
    expect(screen.queryByText(/será disponibilizad/)).toBeNull();
  });
});

describe('FlowRegistrarResultadoRemoto — atomicidade', () => {
  it('sucesso não deixa a UI "pendente" de uma segunda etapa — nenhum segundo registerVisitResult é permitido', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Salvar resultado')).toBeNull();
  });
});

describe('FlowRegistrarResultadoRemoto — pending/double-submit', () => {
  it('isPending=true: clique não gera segunda chamada', () => {
    m.useRegisterVisitResult.mockImplementation(() => registerHookResult(registerVisitResultSpy, { isPending: true }));
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');

    expect(screen.getByText('Registrando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Registrando…'));
    expect(registerVisitResultSpy).not.toHaveBeenCalled();
  });
});

describe.each([
  ['stale_write', 'remote_visits_mutation_stale_write', 'Esta visita foi alterada. Os dados foram atualizados.'],
  ['visit_closed', 'remote_visits_mutation_visit_closed', 'Esta visita já foi encerrada.'],
  ['visit_not_found', 'remote_visits_mutation_visit_not_found', 'Esta visita não está mais disponível.'],
  ['forbidden', 'remote_visits_mutation_forbidden', 'Você não tem permissão para registrar o resultado desta visita.'],
] as const)('FlowRegistrarResultadoRemoto — erro %s (REOPEN REQUIRED)', (_label, code, expectedMessage) => {
  it(`mostra "${expectedMessage}", bloqueia novos submits, sem sucesso, sem follow-up`, async () => {
    registerVisitResultSpy.mockRejectedValueOnce(new RemoteVisitsError(code as any, { operation: 'register_visit_result' }));
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');
    submit();

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.queryByText(/Resultado registrado/)).toBeNull();
    expect(m.saleServiceCreate).not.toHaveBeenCalled();

    registerVisitResultSpy.mockResolvedValueOnce({});
    submit();
    expect(registerVisitResultSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FlowRegistrarResultadoRemoto — erro genérico (RETRYABLE)', () => {
  it('mostra mensagem, permite nova tentativa, erro anterior é limpo', async () => {
    registerVisitResultSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_generic_error', { operation: 'register_visit_result' }));
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');
    submit();
    expect(await screen.findByText('Não foi possível registrar o resultado. Tente novamente.')).toBeInTheDocument();

    registerVisitResultSpy.mockResolvedValueOnce({});
    submit();
    await waitFor(() => expect(registerVisitResultSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Não foi possível registrar o resultado. Tente novamente.')).toBeNull());
  });
});

describe('FlowRegistrarResultadoRemoto — identity_changed', () => {
  it('fecha o flow, nenhuma mensagem de erro, nenhum sucesso declarado por engano', async () => {
    registerVisitResultSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'register_visit_result' }));
    const { close } = renderFlow({ visit: remoteVisit() });
    pickOutcome('Fechou negócio');
    submit();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText(/Resultado registrado/)).toBeNull();
  });

  it('identity_changed durante a ponte: zero Nova negociação, zero mutation Deals (B6-PRECHECK §22)', async () => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    registerVisitResultSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'register_visit_result' }));
    const { close } = renderFlow({ visit: remoteVisit({ leadId: 'lead-1' }) });
    pickOutcome('Em negociação');
    submit();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(m.openFlow).not.toHaveBeenCalled();
  });
});

// ── COMMERCIAL-REMOTE-DEALS-B6 — ponte Visits → Negociações ─────────────

describe('FlowRegistrarResultadoRemoto — ponte: Visit vinculada + Deals pronto', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
  });

  it('negotiating + Lead resolvido: transição direta para Nova negociação, ZERO create_deal automático', async () => {
    const lead = remoteLead({ id: 'lead-1', name: 'Cliente Remoto' });
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([lead]));
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1', vehicles: ['Golf GTI 2022'] }) });
    pickOutcome('Em negociação');
    submit();

    await waitFor(() => expect(m.openFlow).toHaveBeenCalledTimes(1));
    expect(m.openFlow).toHaveBeenCalledWith('nova-proposta', { lead, vehicle: 'Golf GTI 2022' });
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
    // Transição direta: nenhum success state intermediário da Visit.
    expect(screen.queryByText(/Resultado registrado/)).toBeNull();
  });

  it('resultado da Visit falha: zero Nova negociação, zero create Deal (B6-PRECHECK §21)', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
    registerVisitResultSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_generic_error', { operation: 'register_visit_result' }));
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1' }) });
    pickOutcome('Em negociação');
    submit();

    await screen.findByText('Não foi possível registrar o resultado. Tente novamente.');
    expect(m.openFlow).not.toHaveBeenCalled();
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
  });

  it('Visit standalone (leadId null): zero Nova negociação, mensagem orienta a vincular um cliente', async () => {
    renderFlow({ visit: remoteVisit({ leadId: null }) });
    pickOutcome('Em negociação');
    submit();

    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(m.openFlow).not.toHaveBeenCalled();
    expect(screen.getByText(/vincule esta visita a um cliente cadastrado/)).toBeInTheDocument();
  });

  it('Visit vinculada mas Lead não resolvido no snapshot (ex.: arquivado): zero Nova negociação, mensagem neutra', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([])); // Lead não está no snapshot
    renderFlow({ visit: remoteVisit({ leadId: 'lead-arquivado' }) });
    pickOutcome('Em negociação');
    submit();

    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(m.openFlow).not.toHaveBeenCalled();
    expect(screen.getByText(/Não foi possível preparar a negociação automaticamente\./)).toBeInTheDocument();
    // Nunca a mensagem de standalone — a Visit TEM leadId, só não achou o Lead.
    expect(screen.queryByText(/vincule esta visita a um cliente cadastrado/)).toBeNull();
  });

  it('snapshot de Leads em loading: mesmo tratamento de não-resolvido, Visit result não fica bloqueada', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()], { isLoading: true }));
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1' }) });
    pickOutcome('Em negociação');
    submit();

    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(m.openFlow).not.toHaveBeenCalled();
    expect(registerVisitResultSpy).toHaveBeenCalledTimes(1);
  });

  it('snapshot de Leads em erro: mesmo tratamento de não-resolvido', async () => {
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()], { isError: true }));
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1' }) });
    pickOutcome('Em negociação');
    submit();

    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(m.openFlow).not.toHaveBeenCalled();
  });
});

describe.each(['deal_local', 'deal_blocked', 'deal_remote_misconfigured'] as const)(
  'FlowRegistrarResultadoRemoto — ponte bloqueada: Deals em %s (CRÍTICO — zero fallback local)',
  (dealMode) => {
    it('negotiating + Lead resolvido: resultado salvo normalmente, zero Nova negociação, zero FlowNovaProposta local, zero DealService', async () => {
      m.resolveDealRemoteMode.mockReturnValue(dealMode);
      m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead()]));
      renderFlow({ visit: remoteVisit({ leadId: 'lead-1' }) });
      pickOutcome('Em negociação');
      submit();

      expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
      expect(m.openFlow).not.toHaveBeenCalled();
      expect(m.dealServiceCreate).not.toHaveBeenCalled();
    });
  },
);

describe('FlowRegistrarResultadoRemoto — ponte: prefill de veículo (CRÍTICO)', () => {
  beforeEach(() => {
    m.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    m.useRemoteLeadsScreenState.mockImplementation(() => leadsScreenResult([remoteLead({ id: 'lead-1', car: 'HB20' })]));
  });

  it('exatamente 1 veículo útil (com espaços): prefilled, trimmed', async () => {
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1', vehicles: [' Onix Premier '] }) });
    pickOutcome('Em negociação');
    submit();
    await waitFor(() => expect(m.openFlow).toHaveBeenCalledTimes(1));
    expect(m.openFlow.mock.calls[0][1].vehicle).toBe('Onix Premier');
  });

  it('0 veículos: vazio, NUNCA usa o car do Lead (HB20) como fallback', async () => {
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1', vehicles: [] }) });
    pickOutcome('Em negociação');
    submit();
    await waitFor(() => expect(m.openFlow).toHaveBeenCalledTimes(1));
    expect(m.openFlow.mock.calls[0][1].vehicle).toBe('');
  });

  it('2+ veículos: vazio, nenhuma escolha arbitrária, NUNCA usa o car do Lead (HB20)', async () => {
    renderFlow({ visit: remoteVisit({ leadId: 'lead-1', vehicles: ['Onix', 'Polo'] }) });
    pickOutcome('Em negociação');
    submit();
    await waitFor(() => expect(m.openFlow).toHaveBeenCalledTimes(1));
    expect(m.openFlow.mock.calls[0][1].vehicle).toBe('');
  });
});
