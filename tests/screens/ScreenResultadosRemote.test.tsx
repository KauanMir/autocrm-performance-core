// Testes de isolamento por modo de ScreenResultados (COMMERCIAL-REMOTE-
// RESULTS-R1). Mesmo padrão exato de
// tests/screens/ScreenVendasCommercialIsolation.test.tsx: hooks mockados
// diretamente no nível da tela (useRemoteSalesScreenState/
// useCurrentCompanySellerLabels), nenhum QueryClientProvider real
// necessário. buildSalesRanking NÃO é mockado — a agregação real (já
// coberta isoladamente em tests/sales/salesRanking.test.ts) é exercitada
// aqui para provar que a tela usa Sales reais, nunca fixture.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteSalesScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  isLocalCommercialDataAllowed: vi.fn(),
  sellers: vi.fn(() => [] as any[]),
  user: { current: null as any },
  go: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteSalesScreenState', () => ({
  useRemoteSalesScreenState: m.useRemoteSalesScreenState,
}));
vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: m.useCurrentCompanySellerLabels,
}));
vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

// Mesmo conjunto de mocks de módulo já provado necessário para importar
// ScreensBiz.tsx inteiro (mesmo motivo documentado em
// ScreenVendasCommercialIsolation.test.tsx).
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
vi.mock('@/lib/hooks/useRemoteDealsScreenState', () => ({ useRemoteDealsScreenState: () => ({ mode: 'deal_local', deals: [] }) }));
vi.mock('@/components/invites/InviteList', () => ({ InviteList: () => <div /> }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => m.sellers() },
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.user.current?.activeMembership?.role === 'manager' },
  CompanyService: { get: () => ({ name: '', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { ScreenResultados } from '@/components/screens/ScreensBiz';

function saleScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, sales: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function sellerLabelsState(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: ['seller-labels'],
    sellerLabels: [], sellersById: { s1: { id: 's1', name: 'Lucas Martins' }, s2: { id: 's2', name: 'Fernanda Dias' } },
    isLoading: false, isFetching: false, isError: false, error: null, isEmpty: false, hasData: true,
    refetch: vi.fn(),
    ...over,
  };
}

function remoteSale(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sale-1', companyId: 'company-a', dealId: 'deal-1', leadId: 'lead-1', assignedSellerId: 's1',
    soldValueCents: 10000000, paymentMethod: 'a_vista', soldBy: 'profile-1',
    soldAt: '2026-08-22T10:00:00.000Z', createdAt: '2026-08-22T10:00:00.000Z',
    ...over,
  };
}

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };

beforeEach(() => {
  m.sellers.mockReset().mockReturnValue([]);
  m.isLocalCommercialDataAllowed.mockReset().mockReturnValue(true);
  m.useRemoteSalesScreenState.mockReset().mockReturnValue(saleScreenState('sale_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsState());
  m.user.current = LOCAL_MANAGER;
  m.go.mockReset();
});

describe('ScreenResultados — sale_local (preservado)', () => {
  it('renderiza fixtures locais (SellerService), zero chamada aos hooks remotos de agregação', () => {
    m.sellers.mockReturnValue([{ id: 'sel-1', name: 'Marcos Silva', leads: 4, visits: 3, conv: 40, sales: 2 }]);

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByText('Resultados')).toBeInTheDocument();
    expect(screen.getByText('Marcos Silva')).toBeInTheDocument();
    expect(screen.getByText('Conversão por etapa')).toBeInTheDocument();
  });
});

describe.each([
  ['sale_blocked'],
  ['sale_remote_misconfigured'],
] as const)('ScreenResultados — %s', (mode) => {
  it('aviso genérico de módulo em migração, SellerService.getAll não chamado', () => {
    m.sellers.mockReturnValue([{ id: 'sel-1', name: 'Vendedor Antigo', leads: 1, visits: 1, conv: 1, sales: 1 }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState(mode));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.queryByText('Vendedor Antigo')).toBeNull();
  });
});

describe('ScreenResultados — sale_remote_unavailable_identity', () => {
  it('estado neutro, nenhum dado antigo', () => {
    m.sellers.mockReturnValue([{ id: 'sel-1', name: 'X', leads: 1, visits: 1, conv: 1, sales: 1 }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByTestId('resultados-state-unavailable-identity')).toBeInTheDocument();
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.queryByText('X')).toBeNull();
  });
});

describe('ScreenResultados — sale_remote_active loading/error/configError', () => {
  it('loading: estado de carregamento, ignora fixtures locais', () => {
    m.sellers.mockReturnValue([{ id: 'sel-1', name: 'Local', leads: 1, visits: 1, conv: 1, sales: 1 }]);
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isLoading: true }));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByTestId('resultados-state-loading')).toBeInTheDocument();
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();
  });

  it('error: mensagem sanitizada + retry chama refetch', () => {
    const refetch = vi.fn();
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isError: true, error: new Error('boom'), refetch }));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByTestId('resultados-state-error')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).toBeNull();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalled();
  });

  it('configError: mensagem de configuração inválida, sem detalhe técnico', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      configError: { ok: false, reason: 'invalid_sale_configuration', code: 'invalid_sold_value', saleId: 's1', rowIndex: 0 },
    }));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByTestId('resultados-state-config-error')).toBeInTheDocument();
    expect(screen.queryByText(/invalid_sold_value/)).toBeNull();
  });
});

describe('ScreenResultados — sale_remote_active vazio', () => {
  it('estado vazio real: "Nenhuma venda registrada no período.", zero zeros fake', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isEmpty: true }));

    render(<ScreenResultados go={m.go} />);

    expect(screen.getByText('Nenhuma venda registrada no período.')).toBeInTheDocument();
  });
});

describe('ScreenResultados — sale_remote_active com dado: ranking real', () => {
  it('duas Sales de Sellers diferentes: ranking real ordenado, zero número fixture (Leads/Visitas/Conv.)', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true,
      sales: [
        remoteSale({ id: 'a', assignedSellerId: 's1', soldValueCents: 10000000 }),
        remoteSale({ id: 'b', assignedSellerId: 's1', soldValueCents: 8000000 }),
        remoteSale({ id: 'c', assignedSellerId: 's2', soldValueCents: 15000000 }),
      ],
    }));

    render(<ScreenResultados go={m.go} />);

    const rows = screen.getAllByTestId('resultados-ranking-row');
    expect(rows).toHaveLength(2);
    // Lucas: 2 vendas / R$ 180.000,00 — vem primeiro por volume, apesar de Fernanda ter mais receita.
    expect(rows[0]).toHaveTextContent('Lucas Martins');
    expect(rows[0]).toHaveTextContent('R$ 180.000,00');
    expect(rows[1]).toHaveTextContent('Fernanda Dias');
    expect(rows[1]).toHaveTextContent('R$ 150.000,00');

    // V1 = somente saleCount/revenueCents (R1-EXEC §3): nenhuma coluna de
    // conversão/leads/visitas sobrevive no branch remoto.
    expect(screen.queryByText('Leads')).toBeNull();
    expect(screen.queryByText('Visitas')).toBeNull();
    expect(screen.queryByText('Conv.')).toBeNull();
    expect(screen.queryByText('Conversão por etapa')).toBeNull();
    expect(screen.queryByText('Motivos de perda')).toBeNull();
    expect(m.sellers).not.toHaveBeenCalled();
  });

  it('Sale com assignedSellerId fora de sellerLabels: linha "Vendedor indisponível", revenue/count preservados', () => {
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true,
      sales: [remoteSale({ id: 'a', assignedSellerId: 'ghost-1', soldValueCents: 5000000 })],
    }));

    render(<ScreenResultados go={m.go} />);

    const rows = screen.getAllByTestId('resultados-ranking-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Vendedor indisponível');
    expect(rows[0]).toHaveTextContent('R$ 50.000,00');
  });

  it('Seller (RLS já entrega só a própria Sale): mostra seu próprio resultado, uma única linha', () => {
    m.user.current = { id: 'user-2', name: 'Vendedor', email: 's@a.com', activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } };
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true,
      sales: [remoteSale({ id: 'own-1', assignedSellerId: 's1', soldValueCents: 4000000 })],
    }));

    render(<ScreenResultados go={m.go} />);

    const rows = screen.getAllByTestId('resultados-ranking-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Lucas Martins');
    expect(rows[0]).toHaveTextContent('R$ 40.000,00');
  });
});
