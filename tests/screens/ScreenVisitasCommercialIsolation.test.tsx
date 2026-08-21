// Testes de isolamento por modo de ScreenVisitas (COMMERCIAL-REMOTE-
// VISITS-B3). Visit ganhou backend remoto próprio (migration #52,
// local-only) — o gate deixou de ser isLocalCommercialDataAllowed() (modo
// de LEADS) e passou a ser remoteVisitsScreen.mode
// (resolveVisitRemoteMode(), via useRemoteVisitsScreenState). Mesmo padrão
// de tests/screens/ScreenPendenciasCommercialIsolation.test.tsx: hooks
// mockados diretamente no nível da tela — nenhum QueryClientProvider real
// necessário, sem retestar a composição já coberta em
// tests/hooks/useRemoteVisitsScreenState.test.tsx.
//
// Este é um lote READ-ONLY: nenhuma mutation (create/confirm/reagendar/
// cancelar/registrar resultado) está conectada em visit_remote_active —
// diferente do precedente de Tasks (B1-B3-D/E), que já tinha create/update
// remotos próprios. "Agendar visita"/"Confirmar"/"Registrar" ficam
// ausentes no modo remoto, não desabilitados.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteVisitsScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  visits: vi.fn(() => [] as any[]),
  user: { current: null as any },
  openFlow: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteVisitsScreenState', () => ({
  useRemoteVisitsScreenState: m.useRemoteVisitsScreenState,
}));
vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: m.useCurrentCompanySellerLabels,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

// Mesmo conjunto de mocks de módulo já provado necessário por
// ScreensBizCommercialIsolation.test.tsx para importar ScreensBiz.tsx
// inteiro (o arquivo exporta ScreenPropostas/ScreenVendas/ScreenResultados
// no mesmo módulo, todos avaliados no import).
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
  VisitService: { getAll: () => m.visits(), create: vi.fn(), update: vi.fn() },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current, isManager: () => false },
  CompanyService: { get: () => ({ name: '', cnpj: '', phone: '', timezone: '' }), update: () => {} },
  PipelineService: { reorderStages: () => {}, getStages: () => [] },
}));

import { VisitService } from '@/lib/services';
import { ScreenVisitas } from '@/components/screens/ScreensBiz';

function visitScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, visits: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
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

function remoteVisit(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'visit-remote-1',
    clientName: 'Cliente Remoto',
    leadId: 'lead-remote-1',
    assignedSellerId: 's1',
    vehicles: ['Onix'],
    scheduledAt: '2026-08-21T13:00:00.000Z',
    status: 'scheduled',
    outcome: null,
    note: '',
    resultNote: null,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const LOCAL_MANAGER = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };

beforeEach(() => {
  m.visits.mockReset().mockReturnValue([]);
  m.useRemoteVisitsScreenState.mockReset().mockReturnValue(visitScreenState('visit_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsState());
  m.user.current = LOCAL_MANAGER;
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
  vi.mocked(VisitService.create).mockReset();
  vi.mocked(VisitService.update).mockReset();
});

describe('ScreenVisitas — visit_local (preservado)', () => {
  it('renderiza visitas locais, Agendar visita presente, ação Ver funciona', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Carlos Andrade', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Marcos Silva', car: 'Onix' }]);
    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Agendar visita')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ver'));
    expect(m.openFlow).toHaveBeenCalledWith('ver-cliente', expect.anything());
  });
});

describe.each([
  ['visit_blocked'],
  ['visit_remote_misconfigured'],
] as const)('ScreenVisitas — %s', (mode) => {
  it('nenhuma Visit local exibida, VisitService.getAll não chamado, Agendar visita ausente', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Cliente Antigo', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Marcos Silva', car: 'Onix' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState(mode));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Agendar visita')).toBeNull();
  });
});

describe('ScreenVisitas — visit_remote_unavailable_identity', () => {
  it('estado neutro, nenhuma Visit antiga, nunca "0 visitas"', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'X', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Y', car: 'Onix' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByTestId('visitas-state-unavailable-identity')).toBeInTheDocument();
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.queryByText('0 visitas')).toBeNull();
  });
});

describe('ScreenVisitas — visit_remote_active loading', () => {
  it('mostra loading, ignora Visits locais, VisitService.getAll não chamado', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Local', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Y', car: 'Onix' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isLoading: true }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByTestId('visitas-state-loading')).toBeInTheDocument();
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();
  });
});

describe('ScreenVisitas — visit_remote_active error', () => {
  it('mostra erro recuperável, chama refetch ao clicar em Tentar novamente, zero Visits locais', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Local', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Y', car: 'Onix' }]);
    const refetch = vi.fn();
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isError: true, error: new Error('x'), refetch }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByTestId('visitas-state-error')).toBeInTheDocument();
    expect(m.visits).not.toHaveBeenCalled();
    expect(screen.queryByText('Local')).toBeNull();

    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('ScreenVisitas — visit_remote_active configError', () => {
  it('mensagem de configuração inválida, sem lista parcial, sem detalhe técnico', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      configError: { ok: false, reason: 'invalid_visit_configuration', code: 'invalid_status', visitId: 'v1', rowIndex: 0 },
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByTestId('visitas-state-config-error')).toBeInTheDocument();
    expect(screen.queryByText(/invalid_status/)).toBeNull();
    expect(screen.queryByText(/SQL|Postgres|Supabase/i)).toBeNull();
  });
});

describe('ScreenVisitas — visit_remote_active com dado', () => {
  // Datas construídas via componentes LOCAIS (ano, mês 0-indexado, dia,
  // hora) em vez de string ISO/UTC crua — auto-consistente com qualquer
  // timezone do runner (B3-EXEC §42: "construir datas locais
  // programaticamente nos testes", nunca depender do TZ real da máquina).
  const NOW = new Date(2026, 7, 21, 12, 0, 0); // 21/ago/2026, 12:00 local

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renderiza cliente/vendedor/veículo/status a partir de remote.visits, VisitService.getAll 0 calls', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [remoteVisit({ scheduledAt: new Date(2026, 7, 21, 13, 0, 0).toISOString(), vehicles: ['Golf', 'Civic'] })],
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByText('Cliente Remoto')).toBeInTheDocument();
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    expect(screen.getByText(/Golf \+ Civic/)).toBeInTheDocument();
    expect(screen.getByText('Agendada')).toBeInTheDocument();
    expect(screen.getByText('13:00')).toBeInTheDocument();
    expect(m.visits).not.toHaveBeenCalled();
  });

  it('agrupa Hoje/Amanhã/Pendentes de resultado corretamente (now fixado)', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [
        remoteVisit({ id: 'today-1', scheduledAt: new Date(2026, 7, 21, 18, 0, 0).toISOString() }),
        remoteVisit({ id: 'tomorrow-1', scheduledAt: new Date(2026, 7, 22, 13, 0, 0).toISOString() }),
        remoteVisit({ id: 'past-1', scheduledAt: new Date(2026, 7, 21, 9, 0, 0).toISOString() }), // já passou (now=12:00 local)
      ],
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByText('Hoje')).toBeInTheDocument();
    expect(screen.getByText('Amanhã')).toBeInTheDocument();
    expect(screen.getByText('Pendentes de resultado')).toBeInTheDocument();
    // Cada grupo tem exatamente 1 visita — nenhuma duplicada entre grupos
    // (regra de prioridade pending-result, B3-PRECHECK §17).
    expect(screen.getAllByText('1 visita')).toHaveLength(3);
  });

  it('Vendedor não resolvido: placeholder neutro, sem split estranho', () => {
    m.useCurrentCompanySellerLabels.mockReturnValue(sellerLabelsState({ sellersById: {} }));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ assignedSellerId: 's-desconhecido' })],
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByText(/Vendedor indisponível/)).toBeInTheDocument();
  });

  it('Lead arquivado (clientName já resolvido pelo adapter): Visit continua renderizada, sem crash', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ clientName: 'Cliente indisponível' })],
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getByText('Cliente indisponível')).toBeInTheDocument();
  });

  it('nome do cliente é texto não-clicável: nenhum openFlow(ver-cliente) a partir da row remota', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit()],
    }));

    render(<ScreenVisitas go={() => {}} />);

    fireEvent.click(screen.getByText('Cliente Remoto'));
    expect(m.openFlow).not.toHaveBeenCalled();
  });

  it('"Agendar visita" ausente e nenhuma ação de mutation (Confirmar/Registrar) renderizada', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit()],
    }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.queryByText('Agendar visita')).toBeNull();
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(screen.queryByText('Registrar')).toBeNull();
    expect(screen.queryByText('Ver')).toBeNull();
    expect(VisitService.create).not.toHaveBeenCalled();
    expect(VisitService.update).not.toHaveBeenCalled();
    expect(m.openFlow).not.toHaveBeenCalled();
  });
});

describe('ScreenVisitas — visit_remote_active vazio', () => {
  it('nenhum grupo quebra com 0 itens, nenhuma Visit local', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Local', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Y', car: 'Onix' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isEmpty: true, visits: [] }));

    render(<ScreenVisitas go={() => {}} />);

    expect(screen.getAllByText('0 visitas').length).toBeGreaterThan(0);
    expect(screen.queryByText('Local')).toBeNull();
  });
});

describe('ScreenVisitas — transição local → remote loading', () => {
  it('Visit local desaparece imediatamente, loading aparece', () => {
    m.visits.mockReturnValue([{ id: 'v1', client: 'Carlos Andrade', day: 'hoje', time: '10:00', status: 'confirmada', seller: 'Y', car: 'Onix' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_local'));

    const { rerender } = render(<ScreenVisitas go={() => {}} />);
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();

    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isLoading: true }));
    rerender(<ScreenVisitas go={() => {}} />);

    expect(screen.queryByText('Carlos Andrade')).toBeNull();
    expect(screen.getByTestId('visitas-state-loading')).toBeInTheDocument();
  });
});
