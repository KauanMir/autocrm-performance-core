// Testes de FlowVerNegociacao — detalhe/edição/marcar-perdida remoto de
// uma Negociação existente (COMMERCIAL-REMOTE-DEALS-B5). useUpdateDeal/
// useMarkDealLost/useCurrentCompanyAssignableSellers/
// useCurrentCompanySellerLabels são mockados diretamente no nível do
// componente — mesmo padrão de tests/flows/FlowNovaPropostaRemote.test.tsx
// (evita QueryClientProvider real). Flow REMOTE-ONLY: nenhum branch local,
// gate fica inteiramente em FlowLayer (coberto em FlowLayer.test.tsx) —
// aqui só a lógica interna do componente.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteDealsError } from '@/lib/deals/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  useUpdateDeal: vi.fn(),
  useMarkDealLost: vi.fn(),
  useCurrentCompanyAssignableSellers: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  dealServiceCreate: vi.fn(),
  dealServiceGetAll: vi.fn(() => [] as any[]),
  leadServiceGetAll: vi.fn(() => [] as any[]),
}));

vi.mock('@/lib/hooks/useUpdateDeal', () => ({ useUpdateDeal: m.useUpdateDeal }));
vi.mock('@/lib/hooks/useMarkDealLost', () => ({ useMarkDealLost: m.useMarkDealLost }));
vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({
  useCurrentCompanyAssignableSellers: m.useCurrentCompanyAssignableSellers,
}));
vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: m.useCurrentCompanySellerLabels,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.user.current?.activeMembership?.role === 'manager' },
  LeadService: { getAll: m.leadServiceGetAll, addToTimeline: vi.fn(), updateHealth: vi.fn() },
  DealService: { getAll: m.dealServiceGetAll, create: m.dealServiceCreate },
  VisitService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowVerNegociacao } from '@/components/flows/Flows2';

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
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' },
    ...overrides,
  };
}

function remoteDeal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-1', leadId: 'lead-1', clientName: 'Carlos Andrade', assignedSellerId: 's1',
    vehicle: 'Golf GTI 2022', valueCents: 12000000, discountPercent: 3,
    paymentMethod: 'financiamento_100', downPaymentCents: null, installments: null, note: '',
    status: 'open', lostBy: null, lostAt: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z', version: 5,
    ...over,
  };
}
function remoteDealRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
    assigned_seller_id: 's1', vehicle: 'Golf GTI 2022', value_cents: 12000000, discount_percent: 3,
    payment_method: 'financiamento_100', down_payment_cents: null, installments: null, note: '',
    status: 'open', lost_by: null, lost_at: null, created_by: 'profile-1', updated_by: 'profile-1',
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-21T12:00:00.000Z', version: 6,
    ...over,
  };
}

function updateHookResult(updateDeal: any, over: Partial<Record<string, unknown>> = {}) {
  return { updateDeal, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function lostHookResult(markDealLost: any, over: Partial<Record<string, unknown>> = {}) {
  return { markDealLost, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function assignableSellersResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    assignableSellers: [{ seller_id: 's1', name: 'Ana Assignable' }, { seller_id: 's2', name: 'Beto Vendedor' }],
    sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}
function sellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [], sellersById: { s1: { id: 's1', name: 'Ana Assignable' }, s2: { id: 's2', name: 'Beto Vendedor' } },
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

let updateDealSpy: ReturnType<typeof vi.fn>;
let markDealLostSpy: ReturnType<typeof vi.fn>;

function renderFlow(deal: any = remoteDeal()) {
  const close = vi.fn();
  const openFlow = vi.fn();
  render(<FlowVerNegociacao payload={{ deal }} close={close} openFlow={openFlow} />);
  return { close, openFlow };
}

beforeEach(() => {
  m.dealServiceCreate.mockReset();
  m.dealServiceGetAll.mockReset().mockReturnValue([]);
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  updateDealSpy = vi.fn().mockResolvedValue(remoteDealRow());
  markDealLostSpy = vi.fn().mockResolvedValue(remoteDealRow({ status: 'lost', lost_by: 'profile-1', lost_at: '2026-08-21T12:00:00.000Z' }));
  m.useUpdateDeal.mockReset().mockImplementation(() => updateHookResult(updateDealSpy));
  m.useMarkDealLost.mockReset().mockImplementation(() => lostHookResult(markDealLostSpy));
  m.useCurrentCompanyAssignableSellers.mockReset().mockImplementation(() => assignableSellersResult());
  m.useCurrentCompanySellerLabels.mockReset().mockImplementation(() => sellerLabelsResult());
  m.user.current = manager();
});

describe('FlowVerNegociacao — detalhe (open)', () => {
  it('renderiza cliente/veículo/valor/pagamento/entrada/parcelas/desconto/observação/vendedor(Manager)/status/atualização', () => {
    renderFlow(remoteDeal({
      vehicle: 'Civic 2023', valueCents: 13000000, paymentMethod: 'entrada_financiamento',
      downPaymentCents: 2000000, installments: '48x de R$ 2.100', discountPercent: 5, note: 'Cliente quer entrega rápida',
    }));

    expect(screen.getAllByText('Carlos Andrade').length).toBeGreaterThan(0);
    expect(screen.getByText('Civic 2023')).toBeInTheDocument();
    expect(screen.getByText('R$ 130.000,00')).toBeInTheDocument();
    expect(screen.getByText('Entrada + Financiamento')).toBeInTheDocument();
    expect(screen.getByText('R$ 20.000,00')).toBeInTheDocument();
    expect(screen.getByText('48x de R$ 2.100')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('Cliente quer entrega rápida')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Em negociação')).toBeInTheDocument();
    expect(screen.getByText(/Atualizada/)).toBeInTheDocument();
  });

  it('omite Entrada/Parcelas/Desconto/Observação quando não aplicáveis; Seller não vê o vendedor responsável', () => {
    m.user.current = seller();
    renderFlow(remoteDeal({ paymentMethod: 'a_vista', downPaymentCents: null, installments: null, discountPercent: 0, note: '' }));

    expect(screen.queryByText('Entrada')).toBeNull();
    expect(screen.queryByText('Parcelas')).toBeNull();
    expect(screen.queryByText('Desconto')).toBeNull();
    expect(screen.queryByText('Observação')).toBeNull();
    expect(screen.queryByText('Vendedor responsável')).toBeNull();
  });
});

describe('FlowVerNegociacao — terminal read-only (lost/sold)', () => {
  it.each(['lost', 'sold'] as const)('%s: mostra status, sem Editar, sem Marcar como perdida', (status) => {
    renderFlow(remoteDeal({ status, lostBy: status === 'lost' ? 'profile-1' : null, lostAt: status === 'lost' ? '2026-08-20T10:00:00Z' : null }));

    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Marcar como perdida')).toBeNull();
    expect(screen.getAllByText('Carlos Andrade').length).toBeGreaterThan(0);
  });
});

describe('FlowVerNegociacao — edição (open)', () => {
  it('prefill exato: Cliente não-editável, campos atuais, desconto >0 já revelado', () => {
    renderFlow(remoteDeal({
      vehicle: 'Civic 2023', valueCents: 13000000, paymentMethod: 'entrada_financiamento',
      downPaymentCents: 2000000, installments: '48x de R$ 2.100', discountPercent: 6, note: 'obs atual',
    }));

    fireEvent.click(screen.getByText('Editar'));

    expect(screen.getByText('O cliente de uma negociação não pode ser alterado.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Buscar cliente/)).toBeNull();
    expect((screen.getByLabelText('Veículo') as HTMLInputElement).value).toBe('Civic 2023');
    expect((screen.getByLabelText('Valor negociado (R$)') as HTMLInputElement).value).toBe('130000');
    expect((screen.getByLabelText('Entrada (R$)') as HTMLInputElement).value).toBe('20000');
    expect((screen.getByLabelText('Parcelas / condição') as HTMLInputElement).value).toBe('48x de R$ 2.100');
    expect(screen.getByText('Desconto aplicado')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
  });

  it('desconto 0: progressive disclosure (oculto até "Aplicar desconto")', () => {
    renderFlow(remoteDeal({ discountPercent: 0 }));
    fireEvent.click(screen.getByText('Editar'));
    expect(screen.queryByText('Desconto aplicado')).toBeNull();
    fireEvent.click(screen.getByText('Aplicar desconto'));
    expect(screen.getByText('Desconto aplicado')).toBeInTheDocument();
  });
});

describe('FlowVerNegociacao — Seller update (echo-back crítico)', () => {
  beforeEach(() => { m.user.current = seller(); });

  it('sem SellerPicker; payload assignedSellerId === currentDeal.assignedSellerId (nunca null)', async () => {
    renderFlow(remoteDeal({ assignedSellerId: 's1' }));
    fireEvent.click(screen.getByText('Editar'));
    expect(screen.queryByText('Vendedor responsável')).toBeNull();

    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(updateDealSpy).toHaveBeenCalled());
    expect(updateDealSpy.mock.calls[0][0].assignedSellerId).toBe('s1');
  });
});

describe('FlowVerNegociacao — Manager update', () => {
  it('SellerPicker preselecionado com o responsável atual; salvar sem trocar mantém o mesmo id', async () => {
    renderFlow(remoteDeal({ assignedSellerId: 's1' }));
    fireEvent.click(screen.getByText('Editar'));
    expect(screen.getByText('Ana Assignable')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(updateDealSpy).toHaveBeenCalled());
    expect(updateDealSpy.mock.calls[0][0].assignedSellerId).toBe('s1');
  });

  it('trocar o responsável envia o novo id', async () => {
    renderFlow(remoteDeal({ assignedSellerId: 's1' }));
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Ana Assignable'));
    fireEvent.click(screen.getByText('Beto Vendedor'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(updateDealSpy).toHaveBeenCalled());
    expect(updateDealSpy.mock.calls[0][0].assignedSellerId).toBe('s2');
  });
});

describe('FlowVerNegociacao — payload de update', () => {
  it('payload exato: sem leadId/companyId/status/actors/lost metadata', async () => {
    renderFlow(remoteDeal({ id: 'deal-9', version: 5, vehicle: 'Onix', valueCents: 9000000, paymentMethod: 'a_vista', discountPercent: 0, note: '', assignedSellerId: 's1' }));
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(updateDealSpy).toHaveBeenCalled());

    expect(updateDealSpy).toHaveBeenCalledWith({
      dealId: 'deal-9',
      expectedVersion: 5,
      vehicle: 'Onix',
      valueCents: 9000000,
      discountPercent: 0,
      paymentMethod: 'a_vista',
      downPaymentCents: null,
      installments: null,
      note: '',
      assignedSellerId: 's1',
    });
  });

  it('trocar entrada_financiamento (preenchida) para à vista neutraliza Entrada/Parcelas no payload', async () => {
    renderFlow(remoteDeal({ paymentMethod: 'entrada_financiamento', downPaymentCents: 2000000, installments: '48x' }));
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('À vista'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(updateDealSpy).toHaveBeenCalled());

    expect(updateDealSpy.mock.calls[0][0].downPaymentCents).toBeNull();
    expect(updateDealSpy.mock.calls[0][0].installments).toBeNull();
  });
});

describe('FlowVerNegociacao — sucesso de update (autoridade do servidor)', () => {
  it('detalhe pós-salvar mostra os dados da row RETORNADA, nunca reconstruídos do formulário', async () => {
    updateDealSpy.mockResolvedValue(remoteDealRow({
      vehicle: 'Valor Diferente Do Servidor', value_cents: 99000000, version: 6,
    }));
    renderFlow(remoteDeal({ vehicle: 'Civic 2023', valueCents: 13000000, version: 5 }));
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.change(screen.getByLabelText('Veículo'), { target: { value: 'O que o usuário digitou' } });
    fireEvent.click(screen.getByText('Salvar alterações'));

    await waitFor(() => expect(screen.getByText('Alterações salvas.')).toBeInTheDocument());
    expect(screen.getByText('Valor Diferente Do Servidor')).toBeInTheDocument();
    expect(screen.getByText('R$ 990.000,00')).toBeInTheDocument();
    expect(screen.queryByText('O que o usuário digitou')).toBeNull();
  });

  it('CRÍTICO — version chain: update retorna N+1, mark lost subsequente usa N+1 (nunca N)', async () => {
    updateDealSpy.mockResolvedValue(remoteDealRow({ version: 8 }));
    renderFlow(remoteDeal({ id: 'deal-1', version: 7 }));

    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(screen.getByText('Alterações salvas.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    await waitFor(() => expect(markDealLostSpy).toHaveBeenCalled());

    expect(markDealLostSpy).toHaveBeenCalledWith({ dealId: 'deal-1', expectedVersion: 8 });
  });
});

describe.each([
  ['stale_write', 'remote_deals_mutation_stale_write', 'Esta negociação foi alterada. Os dados foram atualizados.'],
  ['deal_closed', 'remote_deals_mutation_deal_closed', 'Esta negociação já foi encerrada.'],
  ['deal_not_found', 'remote_deals_mutation_deal_not_found', 'Esta negociação não está mais disponível.'],
] as const)('FlowVerNegociacao — update TERMINAL: %s', (_label, code, message) => {
  it(`mostra "${message}", snapshot vira inoperável: Editar/Marcar como perdida somem`, async () => {
    updateDealSpy.mockRejectedValue(new RemoteDealsError(code as any));
    renderFlow();
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Salvar alterações'));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Marcar como perdida')).toBeNull();
  });
});

describe.each([
  ['invalid_vehicle', 'remote_deals_mutation_invalid_vehicle', 'Informe um veículo válido.'],
  ['invalid_value', 'remote_deals_mutation_invalid_value', 'Informe um valor válido.'],
  ['invalid_discount', 'remote_deals_mutation_invalid_discount', 'O desconto precisa estar entre 0% e 10%.'],
  ['seller_not_found', 'remote_deals_mutation_seller_not_found', 'O vendedor selecionado não está disponível.'],
  ['lead_archived', 'remote_deals_mutation_lead_archived', 'Este cliente já foi arquivado.'],
  ['forbidden', 'remote_deals_mutation_forbidden', 'Você não tem permissão para alterar esta negociação.'],
  ['generic', 'remote_deals_mutation_generic_error', 'Não foi possível concluir a ação. Tente novamente.'],
] as const)('FlowVerNegociacao — update NÃO-TERMINAL: %s', (_label, code, message) => {
  it(`mostra "${message}", permanece em edição, inputs preservados, snapshot continua operável`, async () => {
    updateDealSpy.mockRejectedValue(new RemoteDealsError(code as any));
    renderFlow();
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.change(screen.getByLabelText('Veículo'), { target: { value: 'Veículo Preservado' } });
    fireEvent.click(screen.getByText('Salvar alterações'));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect((screen.getByLabelText('Veículo') as HTMLInputElement).value).toBe('Veículo Preservado');
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });
});

describe('FlowVerNegociacao — identity_changed', () => {
  it('update: fecha o flow, nenhuma mensagem, nenhum "Alterações salvas."', async () => {
    updateDealSpy.mockRejectedValue(new RemoteDealsError('remote_deals_mutation_identity_changed'));
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Alterações salvas.')).toBeNull();
  });

  it('lost: fecha o flow, nenhuma mensagem', async () => {
    markDealLostSpy.mockRejectedValue(new RemoteDealsError('remote_deals_mutation_identity_changed'));
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe('FlowVerNegociacao — confirmação de marcar como perdida', () => {
  it('primeiro clique não muta; Voltar não muta; Confirmar dispara exatamente 1x, sem motivo', async () => {
    renderFlow(remoteDeal({ id: 'deal-1', version: 5 }));

    fireEvent.click(screen.getByText('Marcar como perdida'));
    expect(markDealLostSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Marcar esta negociação como perdida?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Voltar'));
    expect(markDealLostSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Marcar esta negociação como perdida?')).toBeNull();

    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    await waitFor(() => expect(markDealLostSpy).toHaveBeenCalledTimes(1));
    expect(markDealLostSpy).toHaveBeenCalledWith({ dealId: 'deal-1', expectedVersion: 5 });
  });

  it('sucesso: fecha o flow, zero optimistic status local', async () => {
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe.each([
  ['stale_write', 'remote_deals_mutation_stale_write', 'Esta negociação foi alterada. Os dados foram atualizados.'],
  ['deal_closed', 'remote_deals_mutation_deal_closed', 'Esta negociação já foi encerrada.'],
  ['deal_not_found', 'remote_deals_mutation_deal_not_found', 'Esta negociação não está mais disponível.'],
] as const)('FlowVerNegociacao — lost TERMINAL: %s', (_label, code, message) => {
  it(`snapshot vira inoperável: Editar/Marcar como perdida somem, sem retry`, async () => {
    markDealLostSpy.mockRejectedValue(new RemoteDealsError(code as any));
    renderFlow();
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Marcar como perdida')).toBeNull();
  });
});

describe.each([
  ['forbidden', 'remote_deals_mutation_forbidden', 'Você não tem permissão para alterar esta negociação.'],
  ['generic', 'remote_deals_mutation_generic_error', 'Não foi possível concluir a ação. Tente novamente.'],
] as const)('FlowVerNegociacao — lost NÃO-TERMINAL: %s', (_label, code, message) => {
  it('mostra mensagem, sai da confirmação, snapshot continua operável (Marcar como perdida reaparece)', async () => {
    markDealLostSpy.mockRejectedValue(new RemoteDealsError(code as any));
    renderFlow();
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByText('Marcar como perdida')).toBeInTheDocument();
  });
});

describe('FlowVerNegociacao — double submit', () => {
  it('update pending: Salvar alterações não gera segunda chamada', async () => {
    let resolveUpdate: (v: unknown) => void = () => {};
    updateDealSpy.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    renderFlow();
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Salvar alterações'));
    fireEvent.click(screen.getByText('Salvando…'));
    fireEvent.click(screen.getByText('Salvando…'));
    resolveUpdate(remoteDealRow());
    await waitFor(() => expect(screen.getByText('Alterações salvas.')).toBeInTheDocument());
    expect(updateDealSpy).toHaveBeenCalledTimes(1);
  });

  it('lost pending: Confirmar não gera segunda chamada', async () => {
    let resolveLost: (v: unknown) => void = () => {};
    markDealLostSpy.mockImplementation(() => new Promise((resolve) => { resolveLost = resolve; }));
    const { close } = renderFlow();
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Marcando…'));
    fireEvent.click(screen.getByText('Marcando…'));
    resolveLost(remoteDealRow({ status: 'lost' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(markDealLostSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FlowVerNegociacao — zero fetch novo, zero fallback local', () => {
  it('abrir/editar/marcar perdida nunca chamam DealService/LeadService', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Cancelar'));
    fireEvent.click(screen.getByText('Marcar como perdida'));
    fireEvent.click(screen.getByText('Voltar'));

    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceCreate).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });
});
