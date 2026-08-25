// Testes de integração de "Clientes" (M1-E, E3-B1). useRemoteLeadsScreenState
// é mockado (usePipelineStages/useLeads/useCurrentCompanySellerLabels
// internos já têm cobertura própria); services mockados; sem Supabase real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useArchivedLeads: vi.fn(),
  openFlow: vi.fn(),
  leads: { current: [] as any[] },
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

// M1-E E6-B2-B — ScreenClientesLegacy chama useArchivedLeads diretamente
// (Ativos/Arquivados); mockado aqui pelo mesmo motivo de
// useRemoteLeadsScreenState — evita depender de QueryClientProvider real
// neste arquivo (que testa o roteamento/estados da tela, não a query).
vi.mock('@/lib/hooks/useArchivedLeads', () => ({
  useArchivedLeads: m.useArchivedLeads,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads.current },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [{ id: 's1', first: 'Marcos' }] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: vi.fn(), getStages: () => [] },
}));

import { ScreenClientes } from '@/components/screens/ScreensOps';

function localLead(id: string, name: string, urgency: string, stage = 'Novo') {
  return {
    id, name, stage, phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: 'Marcos Silva', sellerId: 's1', urgency,
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function remoteLead(id: string, name: string, urgency: string, sellerId: string | null = 's1') {
  return {
    id, name, stage: 'Novo', stageId: 'stage-new', phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: sellerId ? 'Ana Souza' : '—', sellerId, urgency,
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true, queryKey: [],
    stages: [{ id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false }],
    byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function sellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [{ seller_id: 's1', name: 'Ana Souza' }], sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function leadsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function screenState(mode: string, over: {
  pipeline?: Partial<Record<string, unknown>>;
  sellerLabels?: Partial<Record<string, unknown>>;
  leads?: Partial<Record<string, unknown>>;
} = {}) {
  return {
    mode,
    pipeline: pipelineResult(over.pipeline),
    sellerLabels: sellerLabelsResult(over.sellerLabels),
    leads: leadsResult(over.leads),
  };
}

function renderScreen(initialFilter?: string) {
  return render(<ScreenClientes go={() => {}} initialFilter={initialFilter ?? null} />);
}

function archivedLeadsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: false, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.leads.current = [localLead('l1', 'Carlos Andrade', 'red'), localLead('l2', 'Juliana Prado', 'green')];
  m.user.current = {
    id: 'user-1', name: 'Gerente', email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
  m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
  m.useArchivedLeads.mockReturnValue(archivedLeadsResult());
  (window as any).__openFlow = m.openFlow;
  m.openFlow.mockReset();
});

describe('ScreenClientes — caminho local intacto (REMOTE_LEADS=false)', () => {
  it('usa LeadService.getAll() e mostra "Novo cliente"', () => {
    renderScreen();
    expect(screen.getByText('Novo cliente')).toBeInTheDocument();
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Juliana Prado')).toBeInTheDocument();
  });

  it('LeadCard local não é readOnly: ações de mutation aparecem no card', () => {
    renderScreen();
    expect(screen.getAllByText(/Ligar/).length).toBeGreaterThan(0);
  });
});

describe('ScreenClientes — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('mostra estado de configuração indisponível, sem "Novo cliente", sem dados locais', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-misconfigured')).toHaveTextContent(
      'As etapas remotas precisam estar disponíveis para carregar os Leads.',
    );
    expect(screen.queryByText('Novo cliente')).toBeNull();
    expect(screen.queryByText('Carlos Andrade')).toBeNull();
    expect(screen.queryByTestId('clientes-grid')).toBeNull();
  });
});

describe('ScreenClientes — remote_unavailable_identity', () => {
  it('mostra sessão indisponível, sem dados locais', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-disabled')).toHaveTextContent('Sessão indisponível');
    expect(screen.queryByText('Carlos Andrade')).toBeNull();
  });
});

// PILOT-UI-TRUTH-FIXES-R1-EXEC §11 — achado do PILOT-UI-TRUTH-AUDIT-A1: Home
// "Ver atrasados" navegava para Clientes sem aplicar filtro nenhum. Agora
// App.tsx repassa go('clientes', {filter:'Atrasados'}) como initialFilter;
// ScreenClientes só aceita um valor pertencente a CLIENT_FILTERS, senão cai
// no padrão 'Todos' de sempre (comportamento intocado sem o parâmetro).
describe('ScreenClientes — initialFilter vindo da navegação (PILOT-UI-TRUTH-FIXES-R1-EXEC §11)', () => {
  it('initialFilter="Atrasados" abre a tela já filtrada (só o Lead urgency=red aparece)', () => {
    renderScreen('Atrasados');
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.queryByText('Juliana Prado')).toBeNull();
  });

  it('sem initialFilter: comportamento padrão intacto (Todos, ambos os Leads aparecem)', () => {
    renderScreen();
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Juliana Prado')).toBeInTheDocument();
  });

  it('initialFilter com valor desconhecido é ignorado (cai em Todos, nunca quebra)', () => {
    renderScreen('valor-que-nao-existe');
    expect(screen.getByText('Carlos Andrade')).toBeInTheDocument();
    expect(screen.getByText('Juliana Prado')).toBeInTheDocument();
  });
});

describe('ScreenClientes — remote_active, estados', () => {
  it('loading de stages mostra skeleton, sem dados', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, isLoading: true } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('clientes-grid')).toBeNull();
  });

  it('erro de stages mostra estado de erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, isError: true, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-error');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('configError de stages mostra mensagem sanitizada', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, configError: { ok: false, reason: 'name-mismatch' } } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-state-stage-config-error')).toBeInTheDocument();
  });

  it('leads com configError (stage/seller órfão) mostra estado sanitizado, sem UUID', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { configError: { ok: false, code: 'seller_not_found', leadId: 'lead-x' }, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-lead-config-error');
    expect(state.textContent).not.toContain('lead-x');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('leads em loading mostra skeleton', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isLoading: true, isEmpty: false } }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-skeleton')).toBeInTheDocument();
  });

  it('erro de leads sem cache mostra estado de erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    renderScreen();
    const state = screen.getByTestId('clientes-state-error');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('leads vazio real mostra estado vazio dedicado', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    renderScreen();
    expect(screen.getByTestId('clientes-state-empty')).toHaveTextContent('Nenhum cliente cadastrado ainda.');
  });

  it('erro com dados anteriores mantém a grade e mostra aviso discreto', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { isError: true, hasData: true, isEmpty: false, leads: [remoteLead('l1', 'Ana Vitória', 'green')], refetch },
      }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-grid')).toBeInTheDocument();
    const warning = screen.getByTestId('clientes-stale-warning');
    fireEvent.click(within(warning).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenClientes — remote_active, sucesso', () => {
  it('renderiza clientes remotos, sem botão "Novo cliente", sem dado local', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'red'), remoteLead('r2', 'Bruno Lima', 'green')] },
      }),
    );
    renderScreen();
    expect(screen.getByTestId('clientes-grid')).toBeInTheDocument();
    expect(screen.getByText('Ana Vitória')).toBeInTheDocument();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
    expect(screen.queryByText('Novo cliente')).toBeNull();
    expect(screen.queryByText('Carlos Andrade')).toBeNull(); // nenhum dado local vaza
  });

  // M1-E E5-B2-A2: Ligar agora deixou de depender de canApplyEvents — usa
  // canLogCallOutcome + posse do Lead (Manager operacional: qualquer Lead
  // da empresa). Visita/Proposta/Acompanhar seguem sempre fora (E7).
  it('cards remotos: Ligar agora aparece para Manager operacional; Visita continua ausente (canApplyEvents ainda false)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'amber')] },
      }),
    );
    renderScreen();
    expect(screen.getByText('Ligar agora')).toBeInTheDocument();
    expect(screen.queryByText('Visita')).toBeNull();
  });

  it('card remoto: Seller sem posse do Lead (sellerId diferente) não vê Ligar agora', () => {
    m.user.current = {
      id: 'user-2', name: 'Vendedor', email: 's@a.com',
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's-outro' },
    };
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'amber', 's1')] },
      }),
    );
    renderScreen();
    expect(screen.queryByText('Ligar agora')).toBeNull();
  });

  // M1-E E4-B2: LeadCard passou a propagar capabilities (não mais o
  // booleano readOnly) — canCreate/canEditDetails true (E4). M1-E E5-B1:
  // canMoveStage também true para este Manager operacional (Kanban remoto
  // conectado). M1-E E5-B2-A2: canLogCallOutcome também true. M1-E E6-B2-A:
  // canAssignSeller/canArchive também true (Manager-only); canApplyEvents
  // segue sempre false (eventos genéricos permanecem fora de escopo).
  it('abrir o card chama __openFlow com capabilities granulares (canCreate/canEditDetails/canMoveStage/canLogCallOutcome/canAssignSeller/canArchive true, canApplyEvents false)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'amber')] },
      }),
    );
    renderScreen();
    fireEvent.click(screen.getByText('Ana Vitória'));
    expect(m.openFlow).toHaveBeenCalledWith('ver-cliente', expect.objectContaining({
      capabilities: {
        canCreate: true,
        canEditDetails: true,
        canApplyEvents: false,
        canMoveStage: true,
        canLogCallOutcome: true,
        canAssignSeller: true,
        canArchive: true,
      },
    }));
  });

  it('filtro por vendedor usa os seller labels remotos (nunca SellerService)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: {
          hasData: true, isEmpty: false,
          leads: [remoteLead('r1', 'Ana Vitória', 'red', 's1'), remoteLead('r2', 'Bruno Lima', 'green', 's2')],
        },
        sellerLabels: { sellerLabels: [{ seller_id: 's1', name: 'Rótulo Vendedor Um' }, { seller_id: 's2', name: 'Rótulo Vendedor Dois' }] },
      }),
    );
    renderScreen();
    expect(screen.getByText('Rótulo Vendedor Um')).toBeInTheDocument();
    expect(screen.getByText('Rótulo Vendedor Dois')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Rótulo Vendedor Dois'));
    expect(screen.queryByText('Ana Vitória')).toBeNull();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
  });
});

// M1-E E6-B2-B — área Ativos/Arquivados. useArchivedLeads mockado (m.useArchivedLeads);
// adaptação real (adaptLeadRows) exige pipeline.byId/sellerLabels.sellersById
// populados nos casos de sucesso.
function archivedLeadRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'arch-1', company_id: 'company-a', name: 'Cliente Arquivado', phone: '(11) 90000-0000',
    phone_digits: '11900000000', car: 'Golf GTI', stage_id: 'stage-new', seller_id: 's1',
    urgency: 'green', temperature: null, last_activity_label: null, alert_label: null,
    payment_preference: null, value_amount: null, source: null,
    created_by_profile_id: null, updated_by_profile_id: null,
    archived_at: '2026-07-29T10:00:00+00:00', version: 2,
    created_at: '2026-07-01T10:00:00+00:00', updated_at: '2026-07-29T10:00:00+00:00',
    ...overrides,
  };
}

const ARCHIVED_STAGE_BY_ID = { 'stage-new': { id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false } };
const ARCHIVED_SELLER_BY_ID = { s1: { id: 's1', name: 'Ana Souza' } };

describe('ScreenClientes — visibilidade do toggle Ativos/Arquivados (E6-B2-B)', () => {
  it('Manager operacional em remote_active: toggle visível', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    renderScreen();
    expect(screen.getByTestId('clientes-area-toggle')).toBeInTheDocument();
  });

  it('Seller: toggle nunca aparece (canArchive sempre false)', () => {
    m.user.current = {
      id: 'user-2', name: 'Vendedor', email: 's@a.com',
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' },
    };
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    renderScreen();
    expect(screen.queryByTestId('clientes-area-toggle')).toBeNull();
  });

  it('remote_misconfigured: toggle nunca aparece', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));
    renderScreen();
    expect(screen.queryByTestId('clientes-area-toggle')).toBeNull();
  });

  it('remote_unavailable_identity: toggle nunca aparece', () => {
    // remote_unavailable_identity só ocorre de verdade quando a identidade
    // real está incompleta (sem membership ativa) — mockar junto com um
    // currentUser sem activeMembership reflete o único cenário real em que
    // este modo ocorre (capabilities.canArchive também depende do mesmo
    // currentUser, nunca só do mode mockado).
    m.user.current = { id: 'user-3', name: 'Sem Empresa', email: 'x@a.com', activeMembership: null };
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));
    renderScreen();
    expect(screen.queryByTestId('clientes-area-toggle')).toBeNull();
  });

  it('caminho local (REMOTE_LEADS=false): toggle nunca aparece', () => {
    renderScreen();
    expect(screen.queryByTestId('clientes-area-toggle')).toBeNull();
  });
});

describe('ScreenClientes — lista de Arquivados (Manager)', () => {
  it('clicar em "Arquivados" monta a lista e esconde o chrome de Ativos (Guide/filtros/grid)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { byId: ARCHIVED_STAGE_BY_ID }, sellerLabels: { sellersById: ARCHIVED_SELLER_BY_ID } }),
    );
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ leads: [archivedLeadRow()] }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    expect(screen.getByTestId('arquivados-list')).toBeInTheDocument();
    expect(screen.getByText('Cliente Arquivado')).toBeInTheDocument();
    expect(screen.queryByTestId('clientes-grid')).toBeNull();
  });

  it('loading mostra skeleton', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ isLoading: true }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    expect(screen.getByTestId('arquivados-skeleton')).toBeInTheDocument();
  });

  it('lista vazia mostra "Nenhum Lead arquivado."', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ leads: [] }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    expect(screen.getByTestId('arquivados-state-empty')).toHaveTextContent('Nenhum Lead arquivado.');
  });

  it('erro mostra mensagem sanitizada com retry (nunca SQL/UUID/técnico)', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active'));
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({
      isError: true, refetch, error: { code: '42501', message: 'permission denied for table leads' },
    }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    const state = screen.getByTestId('arquivados-state-error');
    expect(state.textContent).not.toMatch(/42501|permission denied|leads_select|SELECT/i);
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('Lead com stage órfão (configuração inválida) mostra estado sanitizado, sem UUID', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { byId: ARCHIVED_STAGE_BY_ID }, sellerLabels: { sellersById: ARCHIVED_SELLER_BY_ID } }),
    );
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ leads: [archivedLeadRow({ stage_id: 'stage-ghost' })] }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    const state = screen.getByTestId('arquivados-state-lead-config-error');
    expect(state.textContent).not.toContain('stage-ghost');
  });

  it('clicar num item chama openFlow("ver-cliente-arquivado") com o Lead adaptado (stage/seller resolvidos)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { byId: ARCHIVED_STAGE_BY_ID }, sellerLabels: { sellersById: ARCHIVED_SELLER_BY_ID } }),
    );
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ leads: [archivedLeadRow()] }));
    renderScreen();
    fireEvent.click(screen.getByText('Arquivados'));
    fireEvent.click(screen.getByText('Cliente Arquivado'));
    expect(m.openFlow).toHaveBeenCalledWith('ver-cliente-arquivado', {
      lead: expect.objectContaining({ id: 'arch-1', stage: 'Novo', seller: 'Ana Souza', sellerId: 's1' }),
    });
  });

  it('Ativos e Arquivados nunca se misturam: Lead arquivado nunca aparece na grade de Ativos', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'green')] },
        pipeline: { byId: ARCHIVED_STAGE_BY_ID }, sellerLabels: { sellersById: ARCHIVED_SELLER_BY_ID },
      }),
    );
    m.useArchivedLeads.mockReturnValue(archivedLeadsResult({ leads: [archivedLeadRow()] }));
    renderScreen();
    // clientsArea começa em 'ativos' — nenhum dado de arquivados vaza sem o toggle.
    expect(screen.queryByText('Cliente Arquivado')).toBeNull();
    expect(screen.getByText('Ana Vitória')).toBeInTheDocument();
  });
});
