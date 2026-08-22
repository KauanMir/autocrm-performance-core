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
