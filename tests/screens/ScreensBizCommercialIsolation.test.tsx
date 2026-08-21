// Testes de isolamento fail-closed dos módulos comerciais locais em
// ScreensBiz.tsx (M1-E, E5-B2-A1 + E7-B1): ScreenVendas/ScreenResultados.
// Cobre Barreira 1 (UI) — em modo NÃO local, nenhuma tela chama
// SaleService.getAll(), nenhum dado antigo aparece, nenhuma ação de
// cancelar é oferecida. ScreenResultados (E7-B1) ganhou o mesmo isolamento
// para SellerService (catálogo local sem company_id, sem backend remoto —
// achado do E7-A0), alcançável pelo Manager mesmo em modo remoto
// (NAV_ROLES.manager inclui 'resultados'). Em modo local, comportamento
// preservado integralmente.
//
// ScreenVisitas SAIU deste arquivo (COMMERCIAL-REMOTE-VISITS-B3): Visit
// ganhou backend remoto próprio (migration #52, local-only) e o gate
// deixou de ser isLocalCommercialDataAllowed() (modo de LEADS) — passou a
// ser remoteVisitsScreen.mode (resolveVisitRemoteMode(), via
// useRemoteVisitsScreenState), testado em
// tests/screens/ScreenVisitasCommercialIsolation.test.tsx (mesmo padrão de
// extração já aplicado a ScreenPendencias em B1-B3-C1, ver
// tests/screens/ScreenPendenciasCommercialIsolation.test.tsx).
//
// ScreenPropostas SAIU deste arquivo pelo mesmo motivo
// (COMMERCIAL-REMOTE-DEALS-B3): Deal ganhou backend remoto próprio
// (migration #53, local-only, ainda PENDING REMOTE) e o gate deixou de ser
// só isLocalCommercialDataAllowed() — passou a ser remoteDealsScreen.mode
// (via useRemoteDealsScreenState), testado em
// tests/screens/ScreenPropostasCommercialIsolation.test.tsx. Sale/
// SellerService ainda não migraram — as 2 telas abaixo continuam por
// isLocalCommercialDataAllowed().
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

import { ScreenVendas, ScreenResultados } from '@/components/screens/ScreensBiz';

beforeEach(() => {
  m.isLocalCommercialDataAllowed.mockReset();
  m.visits.mockReset().mockReturnValue([]);
  m.deals.mockReset().mockReturnValue([]);
  m.sales.mockReset().mockReturnValue([]);
  m.sellers.mockReset().mockReturnValue([]);
  m.isManager.mockReset().mockReturnValue(false);
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

describe('ScreenResultados — isolamento por modo (M1-E E7-B1)', () => {
  // M1-E E7-B1: achado real — esta tela chamava SellerService.getAll()
  // incondicionalmente ANTES de qualquer checagem de modo, apesar de
  // 'resultados' estar na navegação do Manager (NAV_ROLES.manager) e
  // portanto alcançável em modo remoto. SellerService (catálogo local, sem
  // company_id, sem backend remoto — achado do E7-A0) precisa do mesmo
  // isolamento Barreira 1 já aplicado a ScreenVisitas/Propostas/Vendas.
  it('modo NÃO local: não chama SellerService.getAll, mostra estado indisponível, nenhum vendedor demo aparece', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.sellers.mockReturnValue([{ id: 's1', name: 'Marcos Silva', leads: 1, visits: 1, conv: 10, sales: 1 }]);
    render(<ScreenResultados go={() => {}} />);
    expect(m.sellers).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Marcos Silva')).toBeNull();
    expect(screen.queryByText('Exportar')).toBeNull();
  });

  it('modo local: renderiza ranking de vendedores e botão Exportar normalmente (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    m.sellers.mockReturnValue([{ id: 's1', name: 'Marcos Silva', leads: 1, visits: 1, conv: 10, sales: 1 }]);
    render(<ScreenResultados go={() => {}} />);
    expect(screen.getByText('Marcos Silva')).toBeInTheDocument();
    expect(screen.getByText('Exportar')).toBeInTheDocument();
    expect(screen.queryByTestId('local-commercial-unavailable')).toBeNull();
  });
});
