// Testes de FlowRegistrarResultadoRemoto — cutover de registro remoto de
// resultado (COMMERCIAL-REMOTE-VISITS-B6-B). useRegisterVisitResult é
// mockado diretamente no nível do componente — mesmo padrão de
// tests/flows/FlowReagendarVisitaRemote.test.tsx (evita QueryClientProvider
// real; a integração completa da mutation já está coberta em
// tests/hooks/useRegisterVisitResult.test.tsx). Este flow é REMOTE-ONLY
// (nenhum branch local): FlowRegistrarResultado local, intocada, continua
// abrindo registrar-venda/nova-proposta/criar-acompanhamento LOCAIS, fora
// do escopo deste arquivo — a regra absoluta provada aqui é o oposto:
// NENHUM desses três (nem SaleService/DealService/TaskService/
// LeadService.updateHealth) é chamado a partir deste flow, em nenhum dos
// 4 outcomes.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteVisitsError } from '@/lib/visits/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  useRegisterVisitResult: vi.fn(),
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

  it('negotiating: título "Em negociação", mensagem de continuidade de Proposta adiada', async () => {
    renderFlow({ visit: remoteVisit() });
    pickOutcome('Em negociação');
    submit();
    expect(await screen.findByText('Resultado registrado: Em negociação')).toBeInTheDocument();
    expect(screen.getByText(/continuidade para Proposta\/Negociação será disponibilizada/)).toBeInTheDocument();
    expect(screen.queryByText('Montar proposta')).toBeNull();
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
});
