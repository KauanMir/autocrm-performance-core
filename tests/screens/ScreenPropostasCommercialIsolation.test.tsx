// Testes de isolamento por modo de ScreenPropostas/Negociações
// (COMMERCIAL-REMOTE-DEALS-B3). Deal ganhou backend remoto próprio
// (migration #53, local-only, ainda PENDING REMOTE) — o gate deixou de ser
// só isLocalCommercialDataAllowed() (modo de LEADS) e passou a ser
// remoteDealsScreen.mode (useRemoteDealsScreenState), com
// isLocalCommercialDataAllowed() preservado INTOCADO dentro do próprio
// branch deal_local (legado byte-for-byte, B3-PRECHECK §4). Mesmo padrão
// exato de tests/screens/ScreenVisitasCommercialIsolation.test.tsx: hooks
// mockados diretamente no nível da tela — nenhum QueryClientProvider real
// necessário, sem retestar a composição já coberta em
// tests/hooks/useRemoteDealsScreenState.test.tsx.
//
// B3 é READ-ONLY (create/update/mark-lost entram em B4/B5, fora de
// escopo): nenhum hook de mutation é mockado aqui porque nenhum é
// importado por ScreenPropostas neste lote.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteDealsScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  isLocalCommercialDataAllowed: vi.fn(),
  deals: vi.fn(() => [] as any[]),
  leads: vi.fn(() => [] as any[]),
  user: { current: null as any },
  openFlow: vi.fn(),
  isManager: vi.fn(() => false),
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
// ScreensBizCommercialIsolation.test.tsx/ScreenVisitasCommercialIsolation.
// test.tsx para importar ScreensBiz.tsx inteiro (o arquivo exporta
// ScreenPropostas/ScreenVisitas/ScreenVendas/ScreenResultados no mesmo
// módulo, todos avaliados no import).
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
  LeadService: { getAll: () => m.leads() },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => m.deals() },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => m.isManager() },
  CompanyService: { get: () => ({ name: '', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { ScreenPropostas } from '@/components/screens/ScreensBiz';

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

function remoteDeal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'deal-remote-1', leadId: 'lead-remote-1', clientName: 'Cliente Remoto', assignedSellerId: 's1',
    vehicle: 'Onix', valueCents: 12000000, discountPercent: 3, paymentMethod: 'financiamento_100',
    downPaymentCents: null, installments: null, note: '', status: 'open', lostBy: null, lostAt: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z', version: 1,
    ...over,
  };
}

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
const LOCAL_SELLER = { id: 'user-2', name: 'Vendedor', email: 's@a.com', activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-self' } };

beforeEach(() => {
  m.deals.mockReset().mockReturnValue([]);
  m.leads.mockReset().mockReturnValue([]);
  m.isManager.mockReset().mockReturnValue(false);
  m.isLocalCommercialDataAllowed.mockReset().mockReturnValue(true);
  m.useRemoteDealsScreenState.mockReset().mockReturnValue(dealScreenState('deal_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsState());
  m.user.current = LOCAL_MANAGER;
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

describe('ScreenPropostas — deal_local (preservado)', () => {
  it('renderiza propostas locais, Nova proposta presente, ação Ver funciona', () => {
    m.deals.mockReturnValue([{ id: 'd1', client: 'Ana Paula', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aberta', last: 'hoje' }]);

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText('Propostas')).toBeInTheDocument();
    expect(screen.getByText('Ana Paula')).toBeInTheDocument();
    expect(screen.getByText('Nova proposta')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ver'));
    expect(m.openFlow).toHaveBeenCalledWith('ver-cliente', expect.anything());
  });
});

describe.each([
  ['deal_blocked'],
  ['deal_remote_misconfigured'],
] as const)('ScreenPropostas — %s', (mode) => {
  it('nenhuma Deal local exibida, DealService.getAll não chamado, Nova proposta ausente', () => {
    m.deals.mockReturnValue([{ id: 'd1', client: 'Cliente Antigo', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva', status: 'aberta', last: 'hoje' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState(mode));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(m.deals).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Nova proposta')).toBeNull();
  });
});

describe('ScreenPropostas — deal_remote_unavailable_identity', () => {
  it('estado neutro, nenhuma Deal antiga, nunca "0 negociações"', () => {
    m.deals.mockReturnValue([{ id: 'd1', client: 'X', car: 'Onix', value: 'R$ 1', seller: 'Y', status: 'aberta', last: 'hoje' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByTestId('negociacoes-state-unavailable-identity')).toBeInTheDocument();
    expect(m.deals).not.toHaveBeenCalled();
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.queryByText(/0 negociaç/)).toBeNull();
  });
});

describe('ScreenPropostas — deal_remote_active loading', () => {
  it('mostra loading, ignora Deals locais, DealService.getAll não chamado', () => {
    m.deals.mockReturnValue([{ id: 'd1', client: 'Local', car: 'Onix', value: 'R$ 1', seller: 'Y', status: 'aberta', last: 'hoje' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isLoading: true }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByTestId('negociacoes-state-loading')).toBeInTheDocument();
    expect(m.deals).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();
  });
});

describe('ScreenPropostas — deal_remote_active error', () => {
  it('mostra erro recuperável, chama refetch ao clicar em Tentar novamente, zero Deals locais', () => {
    m.deals.mockReturnValue([{ id: 'd1', client: 'Local', car: 'Onix', value: 'R$ 1', seller: 'Y', status: 'aberta', last: 'hoje' }]);
    const refetch = vi.fn();
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isError: true, error: new Error('x'), refetch }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByTestId('negociacoes-state-error')).toBeInTheDocument();
    expect(m.deals).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();

    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('ScreenPropostas — deal_remote_active configError', () => {
  it('mensagem de configuração inválida, sem lista parcial, sem detalhe técnico', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      configError: { ok: false, reason: 'invalid_deal_configuration', code: 'invalid_status', dealId: 'd1', rowIndex: 0 },
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByTestId('negociacoes-state-config-error')).toBeInTheDocument();
    expect(screen.queryByText(/invalid_status/)).toBeNull();
    expect(screen.queryByText(/SQL|Postgres|Supabase/i)).toBeNull();
  });
});

describe('ScreenPropostas — deal_remote_active com dado', () => {
  // Data construída via componentes LOCAIS (ano, mês 0-indexado, dia,
  // hora) em vez de string ISO/UTC crua — auto-consistente com qualquer
  // timezone do runner, mesmo padrão de ScreenVisitasCommercialIsolation.
  // O componente calcula `now = new Date()` internamente (não recebe `now`
  // por prop) — por isso o clock precisa ser congelado aqui, exatamente
  // como já é feito para ScreenVisitas.
  const NOW = new Date(2026, 7, 21, 12, 0, 0); // 21/ago/2026, 12:00 local

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('título "Negociações"; renderiza cliente/veículo/valor/vendedor a partir de remote.deals, DealService.getAll 0 calls', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDeal({ vehicle: 'Golf GTI 2022', valueCents: 15800000 })],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText('Negociações')).toBeInTheDocument();
    expect(screen.getByText('Cliente Remoto')).toBeInTheDocument();
    expect(screen.getByText(/Golf GTI 2022/)).toBeInTheDocument();
    expect(screen.getByText('R$ 158.000,00')).toBeInTheDocument();
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    expect(m.deals).not.toHaveBeenCalled();
  });

  it('agrupa Em negociação/Perdidas/Vendidas corretamente, preservando a ordem recebida', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'open-1', clientName: 'Cliente Aberto', status: 'open' }),
        remoteDeal({ id: 'lost-1', clientName: 'Cliente Perdido', status: 'lost', lostBy: 'profile-1', lostAt: '2026-08-20T10:00:00Z' }),
        remoteDeal({ id: 'sold-1', clientName: 'Cliente Vendido', status: 'sold' }),
      ],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText('Em negociação · 1')).toBeInTheDocument();
    expect(screen.getByText('Perdidas · 1')).toBeInTheDocument();
    expect(screen.getByText('Vendidas · 1')).toBeInTheDocument();
    expect(screen.getByText('Cliente Aberto')).toBeInTheDocument();
    expect(screen.getByText('Cliente Perdido')).toBeInTheDocument();
    expect(screen.getByText('Cliente Vendido')).toBeInTheDocument();
  });

  it('Seller: card não repete o próprio nome; Manager: card mostra o vendedor responsável', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ assignedSellerId: 's1' })],
    }));

    const { unmount } = render(<ScreenPropostas go={() => {}} />);
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    unmount();

    m.user.current = LOCAL_SELLER;
    render(<ScreenPropostas go={() => {}} />);
    expect(screen.queryByText(/Lucas/)).toBeNull();
  });

  it('Vendedor não resolvido: placeholder neutro, sem split estranho', () => {
    m.useCurrentCompanySellerLabels.mockReturnValue(sellerLabelsState({ sellersById: {} }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ assignedSellerId: 's-desconhecido' })],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText(/Vendedor indisponível/)).toBeInTheDocument();
  });

  it('nome do cliente é texto não-clicável: nenhum openFlow a partir da row remota, zero LeadService.getAll', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal()],
    }));

    render(<ScreenPropostas go={() => {}} />);

    fireEvent.click(screen.getByText('Cliente Remoto'));
    expect(m.openFlow).not.toHaveBeenCalled();
    expect(m.leads).not.toHaveBeenCalled();
  });

  it('zero badge de status por card — nenhum "Perdida"/"Vendida" singular fora do header de seção', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'lost-1', status: 'lost', lostBy: 'profile-1', lostAt: '2026-08-20T10:00:00Z' }),
        remoteDeal({ id: 'sold-1', status: 'sold' }),
      ],
    }));

    render(<ScreenPropostas go={() => {}} />);

    // Headers usam o plural ("Perdidas"/"Vendidas · N"); o singular nunca é
    // renderizado por nenhum card (nenhum badge de status por linha).
    expect(screen.queryByText('Perdida')).toBeNull();
    expect(screen.queryByText('Vendida')).toBeNull();
  });

  it('seção Perdidas/Vendidas vazia: header ausente (nenhuma seção histórica vazia renderizada)', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ status: 'open' })],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText(/Em negociação/)).toBeInTheDocument();
    expect(screen.queryByText(/Perdidas/)).toBeNull();
    expect(screen.queryByText(/Vendidas/)).toBeNull();
  });

  it('zero negociações abertas: estado simples, sem CTA embutido', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: false, isEmpty: true, deals: [] }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.getByText('Nenhuma negociação em andamento.')).toBeInTheDocument();
  });

  it('zero CTA remoto: "Nova proposta"/"Nova negociação" ausentes, nenhum openFlow(nova-proposta)', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal()],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.queryByText('Nova proposta')).toBeNull();
    expect(screen.queryByText('Nova negociação')).toBeNull();
    expect(m.openFlow).not.toHaveBeenCalledWith('nova-proposta', expect.anything());
  });

  it('zero vocabulário de aprovação e zero footer fake', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'open-1', status: 'open' }),
        remoteDeal({ id: 'lost-1', status: 'lost', lostBy: 'profile-1', lostAt: '2026-08-20T10:00:00Z' }),
        remoteDeal({ id: 'sold-1', status: 'sold' }),
      ],
    }));

    render(<ScreenPropostas go={() => {}} />);

    expect(screen.queryByText(/Propostas/)).toBeNull();
    expect(screen.queryByText(/Aguardando aprovação/)).toBeNull();
    expect(screen.queryByText(/Aguardando gestor/)).toBeNull();
    expect(screen.queryByText(/Aprovada/)).toBeNull();
    expect(screen.queryByText(/Recusada/)).toBeNull();
    expect(screen.queryByText(/Decididas/)).toBeNull();
    expect(screen.queryByText('Revisar')).toBeNull();
    expect(screen.queryByText('Aprovar')).toBeNull();
    expect(screen.queryByText(/propostas fechadas/)).toBeNull();
  });
});
