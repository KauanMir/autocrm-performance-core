// Testes de FlowRegistrarVenda — cutover remoto de registro de Venda
// (COMMERCIAL-REMOTE-SALES-A2). useRegisterSale/resolveSalesRemoteMode são
// mockados diretamente no nível do componente — mesmo padrão exato de
// tests/flows/FlowNovaPropostaRemote.test.tsx (evita QueryClientProvider
// real). O caminho LOCAL (SaleService.create) já tinha cobertura indireta
// (FlowLayer.test.tsx) — reexercitado aqui minimamente para provar que
// continua intacto quando salesDataSource='local'.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteSalesError } from '@/lib/sales/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  resolveSalesRemoteMode: vi.fn(),
  useRegisterSale: vi.fn(),
  useSellerCompetitionEvents: vi.fn(),
  useMarkCompetitionEventsSeen: vi.fn(),
  saleServiceCreate: vi.fn(() => true),
  saleServiceGetAll: vi.fn(() => [] as any[]),
  dealServiceGetAll: vi.fn(() => [] as any[]),
  sellerServiceGetAll: vi.fn(() => [] as any[]),
  leadServiceGetAll: vi.fn(() => [] as any[]),
}));

vi.mock('@/lib/sales/remoteSalesMode', () => ({
  resolveSalesRemoteMode: m.resolveSalesRemoteMode,
}));
vi.mock('@/lib/hooks/useRegisterSale', () => ({
  useRegisterSale: m.useRegisterSale,
}));
// PODIUM-COMPETITION-R2B-B1-EXEC — mesmo motivo de useRegisterSale acima
// (useQuery/useMutation reais exigem QueryClientProvider, ausente aqui).
// Cobertura própria dos hooks em tests/hooks/; aqui só a wiring da
// comemoração dentro do flow.
vi.mock('@/lib/hooks/useSellerCompetitionEvents', () => ({
  useSellerCompetitionEvents: m.useSellerCompetitionEvents,
}));
vi.mock('@/lib/hooks/useMarkCompetitionEventsSeen', () => ({
  useMarkCompetitionEventsSeen: m.useMarkCompetitionEventsSeen,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.user.current?.activeMembership?.role === 'manager' },
  LeadService: { getAll: m.leadServiceGetAll, addToTimeline: vi.fn(), updateHealth: vi.fn() },
  DealService: { getAll: m.dealServiceGetAll, create: vi.fn() },
  VisitService: { getAll: () => [] },
  SaleService: { getAll: m.saleServiceGetAll, create: m.saleServiceCreate, cancel: vi.fn() },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: m.sellerServiceGetAll },
}));

import { FlowRegistrarVenda } from '@/components/flows/Flows2';

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

function remoteDeal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-1', leadId: 'lead-1', clientName: 'Carlos Andrade', assignedSellerId: 's1',
    vehicle: 'Golf GTI 2022', valueCents: 12000000, discountPercent: 0, paymentMethod: 'a_vista',
    downPaymentCents: null, installments: null, note: '', status: 'open', lostBy: null, lostAt: null,
    createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z', version: 3,
    ...overrides,
  };
}

let registerSaleSpy: ReturnType<typeof vi.fn>;
function registerHookResult(registerSale: any, over: Partial<Record<string, unknown>> = {}) {
  return { registerSale, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}

function renderFlow(payload: any = {}) {
  const close = vi.fn();
  render(<FlowRegistrarVenda payload={payload} close={close} />);
  return { close };
}

beforeEach(() => {
  m.resolveSalesRemoteMode.mockReset().mockReturnValue('sale_local');
  m.saleServiceCreate.mockReset().mockReturnValue(true);
  m.saleServiceGetAll.mockReset().mockReturnValue([]);
  m.dealServiceGetAll.mockReset().mockReturnValue([]);
  m.sellerServiceGetAll.mockReset().mockReturnValue([]);
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  registerSaleSpy = vi.fn().mockResolvedValue(remoteDeal({ status: 'sold', version: 4 }));
  m.useRegisterSale.mockReset().mockImplementation(() => registerHookResult(registerSaleSpy));
  m.useSellerCompetitionEvents.mockReset().mockReturnValue({ status: 'local' });
  m.useMarkCompetitionEventsSeen.mockReset().mockReturnValue({ markSeen: vi.fn().mockResolvedValue(0), isPending: false });
  m.user.current = manager();
});

describe('FlowRegistrarVenda — sale_local (preservado)', () => {
  it('renderiza o formulário local de sempre (LeadPicker), zero chamada a useRegisterSale', () => {
    renderFlow();
    expect(screen.getByPlaceholderText('Buscar lead pelo nome ou digitar (venda avulsa)…')).toBeInTheDocument();
    expect(registerSaleSpy).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarVenda — remoto: contexto obrigatório da Deal', () => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it('com payload.deal: mostra Cliente/Veículo read-only, prefill de valor e forma de pagamento', () => {
    renderFlow({ deal: remoteDeal({ clientName: 'Ana Souza', vehicle: 'Civic 2023', valueCents: 9000000, paymentMethod: 'financiamento_100' }) });
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Civic 2023')).toBeInTheDocument();
    expect((screen.getByLabelText('Valor vendido (R$)') as HTMLInputElement).value).toBe('90000');
    expect(screen.getByText('Financiamento 100%')).toBeInTheDocument();
  });

  it('sem payload.deal: formulário remoto renderiza mas Registrar venda fica desabilitado (nunca cria Sale solta)', () => {
    renderFlow({});
    fireEvent.click(screen.getByText('Registrar venda'));
    expect(registerSaleSpy).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarVenda — remoto: validação de valor/pagamento', () => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it('valor em branco: submit não chama registerSale', () => {
    renderFlow({ deal: remoteDeal() });
    fireEvent.change(screen.getByLabelText('Valor vendido (R$)'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Registrar venda'));
    expect(registerSaleSpy).not.toHaveBeenCalled();
  });

  it('valor zero: submit não chama registerSale', () => {
    renderFlow({ deal: remoteDeal() });
    fireEvent.change(screen.getByLabelText('Valor vendido (R$)'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Registrar venda'));
    expect(registerSaleSpy).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarVenda — remoto: submit com sucesso', () => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it('Manager: envia exatamente dealId/expectedVersion/soldValueCents/paymentMethod do formulário', async () => {
    renderFlow({ deal: remoteDeal({ id: 'deal-9', version: 3, valueCents: 12000000, paymentMethod: 'a_vista' }) });
    fireEvent.change(screen.getByLabelText('Valor vendido (R$)'), { target: { value: '115000' } });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(registerSaleSpy).toHaveBeenCalled());
    expect(registerSaleSpy).toHaveBeenCalledWith({
      dealId: 'deal-9',
      expectedVersion: 3,
      soldValueCents: 11500000,
      paymentMethod: 'a_vista',
    });
  });

  it('sucesso: mostra "Venda registrada.", Concluir fecha o flow', async () => {
    const { close } = renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(screen.getByText('Venda registrada.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Concluir'));
    expect(close).toHaveBeenCalled();
  });

  it('Seller: mesmo contrato, nenhum SellerPicker no formulário', async () => {
    m.user.current = seller();
    renderFlow({ deal: remoteDeal({ assignedSellerId: 'seller-self' }) });
    expect(screen.queryByText('Vendedor responsável')).toBeNull();
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(registerSaleSpy).toHaveBeenCalled());
  });
});

describe('FlowRegistrarVenda — remoto: comemoração real (PODIUM-COMPETITION-R2B-B1-EXEC)', () => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  function unseenEvent(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'evt-1', eventType: 'rank_up', sourceType: 'sale', oldRank: 4, newRank: 1, saleCount: 5,
      relatedSellerId: null, relatedSellerLabel: null, competitionStarted: true,
      periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z',
      createdAt: '2026-08-10T12:00:00Z', ...over,
    };
  }

  it('venda melhora o rank: mostra a comemoração real (headline/mensagem), nunca a tela de sucesso genérica', async () => {
    m.user.current = seller();
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'ready', events: [unseenEvent()] });
    renderFlow({ deal: remoteDeal({ assignedSellerId: 'seller-self' }) });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(screen.getByText('Primeira venda do mês!')).toBeInTheDocument());
    expect(screen.queryByText('Venda registrada.')).toBeNull();
  });

  it('venda NÃO melhora o rank (nenhum evento unseen): segue o sucesso normal, nenhuma comemoração inventada', async () => {
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'ready', events: [] });
    renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(screen.getByText('Venda registrada.')).toBeInTheDocument());
  });

  it('Manager registrando para outro Seller: hook nega (unavailable) — sucesso normal, sem comemoração pessoal', async () => {
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'unavailable' });
    renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(screen.getByText('Venda registrada.')).toBeInTheDocument());
  });

  it('fechar a comemoração ("Concluir"): marca visto e fecha o flow', async () => {
    const markSeen = vi.fn().mockResolvedValue(1);
    m.useMarkCompetitionEventsSeen.mockReturnValue({ markSeen, isPending: false });
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'ready', events: [unseenEvent()] });
    const { close } = renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));
    await waitFor(() => expect(screen.getByText('Primeira venda do mês!')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Concluir'));

    await waitFor(() => expect(markSeen).toHaveBeenCalledWith(['evt-1']));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe.each([
  ['forbidden', 'remote_sales_mutation_forbidden', 'Você não tem permissão para registrar esta venda.'],
  ['deal_closed', 'remote_sales_mutation_deal_closed', 'Esta negociação já foi encerrada.'],
  ['deal_not_found', 'remote_sales_mutation_deal_not_found', 'Esta negociação não está mais disponível.'],
  ['stale_write', 'remote_sales_mutation_stale_write', 'Esta negociação foi alterada. Os dados foram atualizados.'],
  ['generic', 'remote_sales_mutation_generic_error', 'Não foi possível concluir a ação. Tente novamente.'],
] as const)('FlowRegistrarVenda — remoto: erro %s', (_label, code, expectedMessage) => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it(`mostra "${expectedMessage}", nunca fecha o form, zero SaleService local`, async () => {
    registerSaleSpy.mockRejectedValue(new RemoteSalesError(code as any));
    renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));

    await waitFor(() => expect(screen.getByText(expectedMessage)).toBeInTheDocument());
    expect(screen.queryByText('Venda registrada.')).toBeNull();
    expect(m.saleServiceCreate).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarVenda — remoto: isolamento de dependências locais (COMMERCIAL-REMOTE-SALES-A3-R2)', () => {
  // Regressão exata do bug encontrado no A3 write-smoke: SellerService.getAll()
  // (e demais serviços locais) são gateados por assertLocalCommercialDataAllowed
  // e lançam LocalCommercialDataDisabledError fora do modo local. Os mocks do
  // topo do arquivo NÃO lançam — para capturar de verdade uma leitura local
  // incondicional, cada serviço aqui lança como o real faria em modo remoto.
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
    const disabled = (op: string) => {
      throw new Error(`LocalCommercialDataDisabledError: ${op}`);
    };
    m.sellerServiceGetAll.mockImplementation(() => disabled('SellerService.getAll'));
    m.saleServiceGetAll.mockImplementation(() => disabled('SaleService.getAll'));
    m.dealServiceGetAll.mockImplementation(() => disabled('DealService.getAll'));
    m.leadServiceGetAll.mockImplementation(() => disabled('LeadService.getAll'));
  });

  it('monta o formulário remoto sem chamar SellerService/SaleService/DealService/LeadService locais', () => {
    renderFlow({ deal: remoteDeal() });
    expect(screen.getByText('Confirmar venda')).toBeInTheDocument();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('Manager sem Deal (SellerPicker seria local): formulário remoto ainda assim não toca serviços locais', () => {
    renderFlow({});
    expect(screen.getByText('Confirmar venda')).toBeInTheDocument();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });
});

describe('FlowRegistrarVenda — remoto: identity_changed', () => {
  beforeEach(() => {
    m.resolveSalesRemoteMode.mockReturnValue('sale_remote_ready');
  });

  it('fecha o flow, nenhuma mensagem de erro, nenhuma tela de sucesso', async () => {
    registerSaleSpy.mockRejectedValue(new RemoteSalesError('remote_sales_mutation_identity_changed'));
    const { close } = renderFlow({ deal: remoteDeal() });
    fireEvent.click(screen.getByText('Registrar venda'));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText('Venda registrada.')).toBeNull();
  });
});
