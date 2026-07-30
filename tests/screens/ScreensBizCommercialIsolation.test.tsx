// Testes de isolamento fail-closed dos módulos comerciais locais em
// ScreensBiz.tsx (M1-E, E5-B2-A1): ScreenVisitas/ScreenPropostas/
// ScreenVendas/ScreenResultados. Cobre Barreira 1 (UI) — em modo NÃO local,
// nenhuma tela chama VisitService/DealService/SaleService.getAll(), nenhum
// dado antigo aparece, nenhuma ação de criar/aprovar/cancelar é oferecida.
// Em modo local, comportamento preservado integralmente.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isLocalCommercialDataAllowed: vi.fn(),
  visits: vi.fn(() => [] as any[]),
  deals: vi.fn(() => [] as any[]),
  sales: vi.fn(() => [] as any[]),
  sellers: vi.fn(() => [] as any[]),
  isManager: vi.fn(() => false),
}));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

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
  VisitService: { getAll: () => m.visits() },
  DealService: { getAll: () => m.deals() },
  SaleService: { getAll: () => m.sales() },
  SellerService: { getAll: () => m.sellers() },
  AuthService: { getCurrentUser: () => null, isManager: () => m.isManager() },
  CompanyService: { get: () => ({ name: '', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { ScreenVisitas, ScreenPropostas, ScreenVendas, ScreenResultados } from '@/components/screens/ScreensBiz';

beforeEach(() => {
  m.isLocalCommercialDataAllowed.mockReset();
  m.visits.mockReset().mockReturnValue([]);
  m.deals.mockReset().mockReturnValue([]);
  m.sales.mockReset().mockReturnValue([]);
  m.sellers.mockReset().mockReturnValue([]);
  m.isManager.mockReset().mockReturnValue(false);
});

describe('ScreenVisitas — isolamento por modo', () => {
  it('modo NÃO local: não chama VisitService.getAll, mostra estado indisponível, nenhum dado antigo aparece', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.visits.mockReturnValue([{ id: 'v1', client: 'Cliente Antigo', day: 'hoje', time: '10:00', status: 'pendente', seller: 'Marcos Silva', car: 'Onix' }]);
    render(<ScreenVisitas go={() => {}} />);
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Agendar visita')).toBeNull();
  });

  it('modo local: renderiza visitas normalmente (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    m.visits.mockReturnValue([{ id: 'v1', client: 'Carlos Andrade', day: 'hoje', time: '10:00', status: 'pendente', seller: 'Marcos Silva', car: 'Onix' }]);
    render(<ScreenVisitas go={() => {}} />);
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.queryByTestId('local-commercial-unavailable')).toBeNull();
  });
});

describe('ScreenPropostas — isolamento por modo', () => {
  it('modo NÃO local: não chama DealService.getAll, mostra estado indisponível, nenhuma ação de aprovar', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.deals.mockReturnValue([{ id: 'd1', client: 'Cliente Antigo', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aprovacao', last: 'hoje', disc: '8%' }]);
    render(<ScreenPropostas go={() => {}} />);
    expect(m.deals).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Nova proposta')).toBeNull();
  });

  it('modo local: renderiza propostas normalmente', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    m.deals.mockReturnValue([{ id: 'd1', client: 'Ana Paula', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aberta', last: 'hoje' }]);
    render(<ScreenPropostas go={() => {}} />);
    expect(screen.getByText('Ana Paula')).toBeInTheDocument();
  });
});

describe('ScreenVendas — isolamento por modo', () => {
  it('modo NÃO local: não chama SaleService.getAll, mostra estado indisponível, nenhuma ação de cancelar', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.isManager.mockReturnValue(true);
    m.sales.mockReturnValue([{ id: 's1', client: 'Cliente Antigo', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', pay: 'À vista', date: 'hoje', status: 'aguardando' }]);
    render(<ScreenVendas go={() => {}} />);
    expect(m.sales).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Registrar venda')).toBeNull();
    expect(screen.queryByText('Cancelar')).toBeNull();
  });

  it('modo local: renderiza vendas normalmente', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    m.sales.mockReturnValue([{ id: 's1', client: 'Beatriz Lima', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', pay: 'À vista', date: 'hoje', status: 'entregue' }]);
    render(<ScreenVendas go={() => {}} />);
    expect(screen.getByText('Beatriz Lima')).toBeInTheDocument();
  });
});

describe('ScreenResultados — exportação bloqueada fora do modo local', () => {
  it('modo NÃO local: botão Exportar não aparece (mistura Leads/Sellers seguros com Sale/Deal/Visit bloqueados)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<ScreenResultados go={() => {}} />);
    expect(screen.queryByText('Exportar')).toBeNull();
  });

  it('modo local: botão Exportar aparece', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    render(<ScreenResultados go={() => {}} />);
    expect(screen.getByText('Exportar')).toBeInTheDocument();
  });

  it('ranking de vendedores (fora do escopo dos 4 domínios) continua renderizando nos dois modos', () => {
    m.sellers.mockReturnValue([{ id: 's1', name: 'Marcos Silva', leads: 1, visits: 1, conv: 10, sales: 1 }]);
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    render(<ScreenResultados go={() => {}} />);
    expect(screen.getByText('Marcos Silva')).toBeInTheDocument();
  });
});
