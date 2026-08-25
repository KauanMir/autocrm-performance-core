// Testes de isolamento por modo de ScreenVendas (COMMERCIAL-REMOTE-
// SALES-A2). Sales ganhou backend remoto próprio (migration #54,
// local-only, ainda PENDING REMOTE) — o gate deixou de ser só
// isLocalCommercialDataAllowed() e passou a ser remoteSalesScreen.mode
// (useRemoteSalesScreenState), com isLocalCommercialDataAllowed()
// preservado INTOCADO dentro do próprio branch sale_local (legado
// byte-for-byte). Mesmo padrão exato de
// tests/screens/ScreenPropostasCommercialIsolation.test.tsx: hooks
// mockados diretamente no nível da tela — nenhum QueryClientProvider real
// necessário, sem retestar a composição já coberta em
// tests/hooks/useRemoteSalesScreenState.test.tsx.
//
// Cliente/Veículo são resolvidos via useRemoteDealsScreenState (join com a
// Deal correspondente, SALES-A2-PRECHECK §7) — mockado aqui também.
//
// CTA global "Ir para negociações" (PILOT-UI-TRUTH-FIXES-R1-EXEC §13,
// renomeado de "Registrar venda") no branch remote_active NUNCA abre o flow
// diretamente — navega para Negociações (go('propostas')), nunca cria uma
// Sale solta.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteSalesScreenState: vi.fn(),
  useRemoteDealsScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  isLocalCommercialDataAllowed: vi.fn(),
  sales: vi.fn(() => [] as any[]),
  user: { current: null as any },
  openFlow: vi.fn(),
  go: vi.fn(),
  isManager: vi.fn(() => false),
}));

vi.mock('@/lib/hooks/useRemoteSalesScreenState', () => ({
  useRemoteSalesScreenState: m.useRemoteSalesScreenState,
}));
vi.mock('@/lib/hooks/useRemoteDealsScreenState', () => ({
  useRemoteDealsScreenState: m.useRemoteDealsScreenState,
}));
vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: m.useCurrentCompanySellerLabels,
}));
vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

// Mesmo conjunto de mocks de módulo já provado necessário por
// ScreenPropostasCommercialIsolation.test.tsx para importar ScreensBiz.tsx
// inteiro (o arquivo exporta ScreenPropostas/ScreenVisitas/ScreenVendas/
// ScreenResultados no mesmo módulo, todos avaliados no import).
vi.mock('@/components/podiums/Podiums', () => ({ PLACE: [{ ring: '#gold' }, { ring: '#silver' }, { ring: '#bronze' }] }));
vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    source: 'local', remoteStagesEnabled: false, queryEnabled: false,
    stages: [], byId: {}, byCode: {}, byName: {}, isLoading: false, isFetching: false,
    isError: false, error: null, configError: null, isEmpty: false, hasData: false, refetch: () => {},
  }),
}));
vi.mock('@/lib/hooks/useReorderStages', () => ({
  useReorderStages: () => ({ reorderStages: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null }),
  getReorderStagesErrorMessage: () => '',
}));
vi.mock('@/components/invites/InviteList', () => ({ InviteList: () => <div /> }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => m.sales() },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.isManager() },
  CompanyService: { get: () => ({ name: '', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { ScreenVendas } from '@/components/screens/ScreensBiz';

function saleScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, sales: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function dealScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, deals: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function sellerLabelsState(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: ['seller-labels'],
    sellerLabels: [], sellersById: { s1: { id: 's1', name: 'Lucas Martins' } },
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true,
    refetch: vi.fn(),
    ...over,
  };
}

function remoteSale(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sale-1', companyId: 'company-a', dealId: 'deal-1', leadId: 'lead-1', assignedSellerId: 's1',
    soldValueCents: 11500000, paymentMethod: 'a_vista', soldBy: 'profile-1',
    soldAt: '2026-08-22T10:00:00.000Z', createdAt: '2026-08-22T10:00:00.000Z',
    ...over,
  };
}

function remoteDeal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-1', leadId: 'lead-1', clientName: 'Cliente Remoto', assignedSellerId: 's1',
    vehicle: 'Onix', valueCents: 12000000, discountPercent: 0, paymentMethod: 'a_vista',
    downPaymentCents: null, installments: null, note: '', status: 'sold', lostBy: null, lostAt: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z', version: 2,
    ...over,
  };
}

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
const LOCAL_SELLER = { id: 'user-2', name: 'Vendedor', email: 's@a.com', activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-self' } };

beforeEach(() => {
  m.sales.mockReset().mockReturnValue([]);
  m.isManager.mockReset().mockReturnValue(false);
  m.isLocalCommercialDataAllowed.mockReset().mockReturnValue(true);
  m.useRemoteSalesScreenState.mockReset().mockReturnValue(saleScreenState('sale_local'));
  m.useRemoteDealsScreenState.mockReset().mockReturnValue(dealScreenState('deal_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsState());
  m.user.current = LOCAL_MANAGER;
  m.go.mockReset();
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

describe('ScreenVendas — sale_local (preservado)', () => {
  it('renderiza vendas locais, Registrar venda abre o flow local diretamente', () => {
    m.sales.mockReturnValue([{ id: 's1', client: 'Ana Paula', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aguardando', pay: 'À vista', date: 'hoje' }]);

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByText('Vendas')).toBeInTheDocument();
    expect(screen.getByText('Ana Paula')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Registrar venda'));
    expect(m.openFlow).toHaveBeenCalledWith('registrar-venda');
    expect(m.go).not.toHaveBeenCalled();
  });
});

describe.each([
  ['sale_blocked'],
  ['sale_remote_misconfigured'],
] as const)('ScreenVendas — %s', (mode) => {
  it('nenhuma Sale local exibida, SaleService.getAll não chamado, Registrar venda ausente', () => {
    m.sales.mockReturnValue([{ id: 's1', client: 'Cliente Antigo', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aguardando', pay: 'À vista', date: 'hoje' }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState(mode));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(m.sales).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Registrar venda')).toBeNull();
  });
});

describe('ScreenVendas — sale_remote_unavailable_identity', () => {
  it('estado neutro, nenhuma Sale antiga, nunca "0 vendas"', () => {
    m.sales.mockReturnValue([{ id: 's1', client: 'X', car: 'Onix', value: 'R$ 1', seller: 'Y', status: 'aguardando', pay: 'À vista', date: 'hoje' }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByTestId('vendas-state-unavailable-identity')).toBeInTheDocument();
    expect(m.sales).not.toHaveBeenCalled();
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.queryByText('Registrar venda')).toBeNull();
  });
});

describe('ScreenVendas — sale_remote_active loading', () => {
  it('mostra loading, ignora Sales locais, CTA ausente', () => {
    m.sales.mockReturnValue([{ id: 's1', client: 'Local', car: 'Onix', value: 'R$ 1', seller: 'Y', status: 'aguardando', pay: 'À vista', date: 'hoje' }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isLoading: true }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByTestId('vendas-state-loading')).toBeInTheDocument();
    expect(m.sales).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();
    expect(screen.queryByText('Registrar venda')).toBeNull();
  });
});

describe('ScreenVendas — sale_remote_active error', () => {
  it('mostra erro recuperável, chama refetch ao clicar em Tentar novamente, zero Sales locais', () => {
    const refetch = vi.fn();
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isError: true, error: new Error('x'), refetch }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByTestId('vendas-state-error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('ScreenVendas — sale_remote_active configError', () => {
  it('mensagem de configuração inválida, sem lista parcial, sem detalhe técnico', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      configError: { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_sold_value', saleId: 's1', rowIndex: 0 },
    }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByTestId('vendas-state-config-error')).toBeInTheDocument();
    expect(screen.queryByText(/invalid_sold_value/)).toBeNull();
  });
});

describe('ScreenVendas — sale_remote_active vazio', () => {
  it('estado vazio verdadeiro: "Nenhuma venda registrada."', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isEmpty: true }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByText('Nenhuma venda registrada.')).toBeInTheDocument();
  });
});

describe('ScreenVendas — sale_remote_active com dado', () => {
  it('renderiza cliente/veículo (via Deal correspondente)/valor/forma de pagamento; Manager vê vendedor', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true, sales: [remoteSale({ soldValueCents: 15800000, paymentMethod: 'financiamento_100' })],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ id: 'deal-1', clientName: 'Carlos Andrade', vehicle: 'Golf GTI 2022' })],
    }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText(/Golf GTI 2022/)).toBeInTheDocument();
    expect(screen.getByText('R$ 158.000,00')).toBeInTheDocument();
    expect(screen.getByText('Financiamento 100%')).toBeInTheDocument();
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    expect(m.sales).not.toHaveBeenCalled();
  });

  it('Seller: card não mostra o vendedor responsável (informação redundante)', () => {
    m.user.current = LOCAL_SELLER;
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true, sales: [remoteSale()],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal()],
    }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.queryByText(/Lucas/)).toBeNull();
  });

  it('Deal correspondente ainda não carregada: fallback neutro, nunca quebra a linha', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true, sales: [remoteSale()],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: false, isEmpty: true, deals: [] }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.getByText('Cliente indisponível')).toBeInTheDocument();
    expect(screen.getByText(/Veículo indisponível/)).toBeInTheDocument();
  });

  it('nenhum botão de cancelar/editar em nenhuma linha (Sale imutável)', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true, sales: [remoteSale()],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal()],
    }));

    render(<ScreenVendas go={m.go} />);

    expect(screen.queryByText('Cancelar')).toBeNull();
    expect(screen.queryByText('Editar')).toBeNull();
  });

  it('CTA "Ir para negociações" NUNCA abre o flow remoto diretamente — navega para Negociações', () => {
    // PILOT-UI-TRUTH-FIXES-R1-EXEC §13: copy renomeada de "Registrar venda"
    // para "Ir para negociações" no branch remote_active — o botão sempre
    // só navegou (go('propostas')), nunca abriu um formulário de venda
    // remoto direto; a copy antiga prometia mais do que entregava.
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true, sales: [remoteSale()],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal()],
    }));

    render(<ScreenVendas go={m.go} />);

    fireEvent.click(screen.getByText('Ir para negociações'));
    expect(m.go).toHaveBeenCalledWith('propostas');
    expect(m.openFlow).not.toHaveBeenCalled();
  });
});
