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
// COMMERCIAL-REMOTE-VISITS-B4/B5/B6-A: create/reagendar/confirmar/cancelar
// já estão conectados em visit_remote_active — useConfirmVisit/
// useCancelVisit são mockados aqui (mesmo motivo dos demais: RemoteVisitRow
// os chama direto, sem QueryClientProvider real neste arquivo). O
// comportamento de Confirmar/Cancelar em si (payload/erros/pending) tem
// sua própria suíte dedicada — este arquivo só prova a integração com a
// tela (visibilidade por elegibilidade, wiring). Registrar resultado
// permanece fora de escopo até B6-B.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteVisitsError } from '@/lib/visits/errors';

const m = vi.hoisted(() => ({
  useRemoteVisitsScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  useConfirmVisit: vi.fn(),
  useCancelVisit: vi.fn(),
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
vi.mock('@/lib/hooks/useConfirmVisit', () => ({
  useConfirmVisit: m.useConfirmVisit,
}));
vi.mock('@/lib/hooks/useCancelVisit', () => ({
  useCancelVisit: m.useCancelVisit,
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

function confirmHookResult(confirmVisit: any, over: Partial<Record<string, unknown>> = {}) {
  return { confirmVisit, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}
function cancelHookResult(cancelVisit: any, over: Partial<Record<string, unknown>> = {}) {
  return { cancelVisit, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}

let confirmVisitSpy: ReturnType<typeof vi.fn>;
let cancelVisitSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  m.visits.mockReset().mockReturnValue([]);
  m.useRemoteVisitsScreenState.mockReset().mockReturnValue(visitScreenState('visit_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsState());
  confirmVisitSpy = vi.fn().mockResolvedValue({});
  cancelVisitSpy = vi.fn().mockResolvedValue({});
  m.useConfirmVisit.mockReset().mockImplementation(() => confirmHookResult(confirmVisitSpy));
  m.useCancelVisit.mockReset().mockImplementation(() => cancelHookResult(cancelVisitSpy));
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

  // COMMERCIAL-REMOTE-VISITS-B4: "Agendar visita" voltou a aparecer aqui
  // (create_visit conectado) — abre o create flow remoto via openFlow,
  // nunca chama VisitService diretamente (a implementação local/remota é
  // decidida dentro de FlowCriarVisita, fora do escopo desta tela). Este
  // fixture não está em Pendentes de resultado, então "Registrar
  // resultado" não aparece; "Ver" nunca existiu no remote path (§17 do B3,
  // texto não-clicável). "Confirmar" tem sua própria suíte de
  // elegibilidade abaixo — não testado aqui.
  it('"Agendar visita" abre o create flow remoto; nenhuma ação de mutation por row salvo Remarcar/Confirmar (Registrar resultado/Ver)', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ scheduledAt: new Date(2026, 7, 21, 18, 0, 0).toISOString() })],
    }));

    render(<ScreenVisitas go={() => {}} />);

    fireEvent.click(screen.getByText('Agendar visita'));
    expect(m.openFlow).toHaveBeenCalledWith('criar-visita');
    expect(VisitService.create).not.toHaveBeenCalled();

    expect(screen.queryByText('Registrar resultado')).toBeNull();
    expect(screen.queryByText('Ver')).toBeNull();
    expect(VisitService.update).not.toHaveBeenCalled();
  });

  // COMMERCIAL-REMOTE-VISITS-B5: "Remarcar" por row abre o flow dedicado
  // de reagendamento, passando a Visit remota completa — nunca chama
  // VisitService.update diretamente (a mutation real acontece dentro de
  // FlowReagendarVisita, fora do escopo desta tela).
  it('"Remarcar" abre reagendar-visita com a Visit remota completa; VisitService.update nunca chamado', () => {
    const visit = remoteVisit({ id: 'visit-remarcar-1', scheduledAt: new Date(2026, 7, 21, 18, 0, 0).toISOString() });
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [visit],
    }));

    render(<ScreenVisitas go={() => {}} />);

    fireEvent.click(screen.getByText('Remarcar'));
    expect(m.openFlow).toHaveBeenCalledWith('reagendar-visita', { visit });
    expect(VisitService.update).not.toHaveBeenCalled();
  });
});

// COMMERCIAL-REMOTE-VISITS-B6-A — Confirmar/Cancelar inline por row.
describe('ScreenVisitas — visit_remote_active: Confirmar/Cancelar (B6-A)', () => {
  // A suíte "action matrix" usa fake timers para fixar Hoje/Pendentes de
  // resultado deterministicamente. As suítes de Confirmar/Cancelar
  // precisam de relógio REAL (waitFor/findBy dependem de polling por timer
  // real — misturar com fake timers sem vi.advanceTimersByTimeAsync trava
  // o teste, mesmo achado já documentado em
  // tests/flows/FlowNovaPendenciaRemote.test.tsx) — por isso usam uma data
  // futura relativa ao relógio real (`Date.now() + 1 dia`), nunca as
  // constantes fake-timed abaixo.
  describe('action matrix (§18 do EXEC)', () => {
    const NOW = new Date(2026, 7, 21, 12, 0, 0);
    const FUTURE_TODAY = new Date(2026, 7, 21, 18, 0, 0).toISOString();
    const PAST_TODAY = new Date(2026, 7, 21, 9, 0, 0).toISOString();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    it('A) scheduled, ativa (não-pending): Confirmar + Remarcar + Cancelar, sem Registrar resultado', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: FUTURE_TODAY })],
      }));
      render(<ScreenVisitas go={() => {}} />);
      expect(screen.getByText('Confirmar')).toBeInTheDocument();
      expect(screen.getByText('Remarcar')).toBeInTheDocument();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
      expect(screen.queryByText('Registrar resultado')).toBeNull();
    });

    it('B) confirmed, ativa: Remarcar + Cancelar, sem Confirmar, sem Registrar resultado', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'confirmed', scheduledAt: FUTURE_TODAY })],
      }));
      render(<ScreenVisitas go={() => {}} />);
      expect(screen.queryByText('Confirmar')).toBeNull();
      expect(screen.getByText('Remarcar')).toBeInTheDocument();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
      expect(screen.queryByText('Registrar resultado')).toBeNull();
    });

    it('C) scheduled, Pendentes de resultado: Registrar resultado + Remarcar + Cancelar, sem Confirmar', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: PAST_TODAY })],
      }));
      render(<ScreenVisitas go={() => {}} />);
      expect(screen.queryByText('Confirmar')).toBeNull();
      expect(screen.getByText('Remarcar')).toBeInTheDocument();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
      expect(screen.getByText('Registrar resultado')).toBeInTheDocument();
    });

    it('D) confirmed, Pendentes de resultado: Registrar resultado + Remarcar + Cancelar, sem Confirmar', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'confirmed', scheduledAt: PAST_TODAY })],
      }));
      render(<ScreenVisitas go={() => {}} />);
      expect(screen.queryByText('Confirmar')).toBeNull();
      expect(screen.getByText('Remarcar')).toBeInTheDocument();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
      expect(screen.getByText('Registrar resultado')).toBeInTheDocument();
    });
  });

  // Relógio REAL nas duas suítes abaixo (nunca fake timers, ver comentário
  // no topo do describe pai) — data futura relativa a Date.now(), não às
  // constantes fake-timed da action matrix.
  const REAL_FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  describe('Confirmar', () => {
    it('chama useConfirmVisit com {visitId, expectedVersion} exatos; zero VisitService/LeadService', async () => {
      const visit = remoteVisit({ id: 'visit-confirm-1', status: 'scheduled', scheduledAt: REAL_FUTURE, version: 4 });
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [visit] }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Confirmar'));
      await waitFor(() => expect(confirmVisitSpy).toHaveBeenCalledWith({ visitId: 'visit-confirm-1', expectedVersion: 4 }));
      expect(VisitService.update).not.toHaveBeenCalled();
    });

    it('isPending=true: clique não gera segunda chamada', () => {
      m.useConfirmVisit.mockImplementation(() => confirmHookResult(confirmVisitSpy, { isPending: true }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Confirmando…'));
      expect(confirmVisitSpy).not.toHaveBeenCalled();
    });

    it('erro (ex.: stale_write) mostra mensagem inline, sem VisitService', async () => {
      confirmVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_stale_write', { operation: 'confirm_visit' }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Confirmar'));
      expect(await screen.findByTestId('visit-confirm-error')).toHaveTextContent('Esta visita foi alterada. Os dados foram atualizados.');
      expect(VisitService.update).not.toHaveBeenCalled();
    });

    it('identity_changed: nenhuma mensagem de erro é mostrada', async () => {
      confirmVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'confirm_visit' }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Confirmar'));
      await waitFor(() => expect(confirmVisitSpy).toHaveBeenCalled());
      expect(screen.queryByTestId('visit-confirm-error')).toBeNull();
    });
  });

  describe('Cancelar — confirmação em duas etapas', () => {
    it('primeiro clique não muta; mostra Sim/Voltar', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      expect(cancelVisitSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Sim')).toBeInTheDocument();
      expect(screen.getByText('Voltar')).toBeInTheDocument();
    });

    it('Voltar descarta sem mutation nenhuma, volta ao estado normal', () => {
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(screen.getByText('Voltar'));
      expect(cancelVisitSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
    });

    it('Cancelar + Sim chama useCancelVisit com {visitId, expectedVersion} exatos; zero VisitService/LeadService/DELETE', async () => {
      const visit = remoteVisit({ id: 'visit-cancel-1', status: 'confirmed', scheduledAt: REAL_FUTURE, version: 9 });
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [visit] }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(screen.getByText('Sim'));
      await waitFor(() => expect(cancelVisitSpy).toHaveBeenCalledWith({ visitId: 'visit-cancel-1', expectedVersion: 9 }));
      expect(VisitService.update).not.toHaveBeenCalled();
    });

    it('isPending=true: segundo "Sim" não gera outra mutation', () => {
      m.useCancelVisit.mockImplementation(() => cancelHookResult(cancelVisitSpy, { isPending: true }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(screen.getByText('Cancelando…'));
      expect(cancelVisitSpy).not.toHaveBeenCalled();
    });

    it('erro (ex.: visit_closed) mostra mensagem inline, sem fechar como sucesso, sem VisitService', async () => {
      cancelVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_visit_closed', { operation: 'cancel_visit' }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(screen.getByText('Sim'));
      expect(await screen.findByTestId('visit-cancel-error')).toHaveTextContent('Esta visita já foi encerrada.');
      expect(VisitService.update).not.toHaveBeenCalled();
    });

    it('identity_changed: nenhuma mensagem de erro é mostrada', async () => {
      cancelVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'cancel_visit' }));
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
        hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: REAL_FUTURE })],
      }));
      render(<ScreenVisitas go={() => {}} />);

      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(screen.getByText('Sim'));
      await waitFor(() => expect(cancelVisitSpy).toHaveBeenCalled());
      expect(screen.queryByTestId('visit-cancel-error')).toBeNull();
    });
  });
});

// COMMERCIAL-REMOTE-VISITS-B6-B: "Registrar resultado" — visível somente
// em Pendentes de resultado (fixture já usa scheduledAt no passado real,
// relógio real, nunca fake timers — mesmo raciocínio já aplicado às
// suítes Confirmar/Cancelar acima).
describe('ScreenVisitas — visit_remote_active: Registrar resultado (B6-B)', () => {
  const REAL_PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('"Registrar resultado" abre registrar-resultado-remoto com a Visit remota completa; VisitService.update nunca chamado', () => {
    const visit = remoteVisit({ id: 'visit-result-1', status: 'scheduled', scheduledAt: REAL_PAST });
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [visit],
    }));

    render(<ScreenVisitas go={() => {}} />);

    fireEvent.click(screen.getByText('Registrar resultado'));
    expect(m.openFlow).toHaveBeenCalledWith('registrar-resultado-remoto', { visit });
    expect(VisitService.update).not.toHaveBeenCalled();
  });

  it('não aparece para Visit ativa (fora de Pendentes de resultado)', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ status: 'scheduled', scheduledAt: future })],
    }));

    render(<ScreenVisitas go={() => {}} />);
    expect(screen.queryByText('Registrar resultado')).toBeNull();
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
