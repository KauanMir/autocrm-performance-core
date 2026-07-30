// Testes de integração do Kanban "Em progresso" (M1-D, commit 6; M1-E E3-B1
// atualizou o mock para o hook de composição).
// useRemoteLeadsScreenState é mockado (usePipelineStages/useLeads/
// useCurrentCompanySellerLabels internos já têm cobertura própria);
// services mockados; sem Supabase real, sem rede, sem snapshots.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  moveCard: vi.fn(),
  getStages: vi.fn(),
  leads: { current: [] as any[] },
  user: { current: null as any },
  attemptMove: vi.fn(),
  isLeadPending: vi.fn((_leadId: string) => false),
  errorCodeByLead: {} as Record<string, string | undefined>,
  clearError: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

// M1-E E5-B1: ScreenAndamentoLegacy agora chama este controller
// incondicionalmente (Rules of Hooks) — mockado aqui para isolar a
// auditoria de wiring (autorização/payload/estados visuais) da lógica
// interna do controller (pendência/token/troca de identidade), já coberta
// em tests/hooks/useRemoteLeadStageMoveController.test.tsx.
vi.mock('@/lib/hooks/useRemoteLeadStageMoveController', () => ({
  useRemoteLeadStageMoveController: () => ({
    attemptMove: m.attemptMove,
    isLeadPending: m.isLeadPending,
    errorCodeByLead: m.errorCodeByLead,
    clearError: m.clearError,
  }),
}));

vi.mock('@/lib/store', () => ({
  useStore: () => ({}),
}));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leads.current },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  PipelineService: { moveCard: m.moveCard, getStages: m.getStages },
}));

import { ScreenAndamento } from '@/components/screens/ScreensOps';

// ── Fixtures ─────────────────────────────────────────────────────────────

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

function stage(code: string, name: string, sortOrder: number, isTerminal = false): PipelineStage {
  return { id: `uuid-${code}`, code, name, sortOrder, isTerminal };
}

const REMOTE_STAGES: PipelineStage[] = [
  stage('new', 'Novo', 0),
  stage('qualified', 'Qualificado', 1),
  stage('visit_scheduled', 'Visita agendada', 2),
  stage('negotiation', 'Em negociação', 3),
  stage('closing', 'Fechamento', 4, true),
];

function lead(id: string, name: string, stageName: string) {
  return {
    id, name, stage: stageName, phone: '(11) 90000-0000', car: 'Golf GTI',
    seller: 'Marcos Silva', sellerId: 's1', urgency: 'green',
    last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function hookResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'remote',
    remoteStagesEnabled: true,
    queryEnabled: true,
    queryKey: ['company', 'company-a', 'pipeline-stages'],
    stages,
    byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null,
    isEmpty: false,
    hasData: stages.length > 0,
    refetch: vi.fn(),
    ...over,
  };
}

function localHookResult(names: readonly string[] = LOCAL_NAMES) {
  const stages = adaptLocalStageNames(names);
  return hookResult({
    source: 'local', remoteStagesEnabled: false, queryEnabled: false, stages,
  });
}

// M1-E E3-B1: useRemoteLeadsScreenState agora é o hook mockado — todos os
// testes deste arquivo cobrem REMOTE_LEADS=false (mode sempre 'local'), então
// leads/sellerLabels do composto nunca são consultados pela tela (que usa
// LeadService.getAll()/SellerService.getAll() quando mode==='local') — os
// defaults abaixo só existem para satisfazer o formato do hook.
function defaultSellerLabels() {
  return {
    remoteLeadsEnabled: false, queryEnabled: false, queryKey: [],
    sellerLabels: [], sellersById: {}, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: true, hasData: false, refetch: vi.fn(),
  };
}

function defaultLeadsResult() {
  return {
    remoteLeadsEnabled: false, queryEnabled: false, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: true, hasData: false, refetch: vi.fn(),
  };
}

function screenState(pipelineOverrides: Partial<Record<string, unknown>> = {}, mode: string = 'local') {
  return {
    mode,
    pipeline: hookResult(pipelineOverrides),
    sellerLabels: defaultSellerLabels(),
    leads: defaultLeadsResult(),
  };
}

function localScreenState(names: readonly string[] = LOCAL_NAMES) {
  return {
    mode: 'local',
    pipeline: localHookResult(names),
    sellerLabels: defaultSellerLabels(),
    leads: defaultLeadsResult(),
  };
}

function renderScreen() {
  return render(<ScreenAndamento go={() => {}} />);
}

beforeEach(() => {
  m.leads.current = [lead('l1', 'Carlos Andrade', 'Novo'), lead('l2', 'Juliana Prado', 'Qualificado')];
  m.user.current = { id: 'user-1', name: 'Admin', email: 'a@a.com' };
  m.getStages.mockReturnValue(LOCAL_NAMES);
  m.useRemoteLeadsScreenState.mockReturnValue(localScreenState());
  m.attemptMove.mockReset();
  m.isLeadPending.mockReset();
  m.isLeadPending.mockReturnValue(false);
  m.errorCodeByLead = {};
  m.clearError.mockReset();
});

// ── A. Caminho local ─────────────────────────────────────────────────────

describe('ScreenAndamento — caminho local (flag OFF)', () => {
  it('renderiza as cinco colunas na ordem recebida, sem skeleton', () => {
    renderScreen();
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual(LOCAL_NAMES);
    expect(screen.queryByTestId('kanban-skeleton')).toBeNull();
  });

  it('agrupa cards por stage.name com contagens corretas', () => {
    renderScreen();
    const colNovo = screen.getByTestId('kanban-col-new');
    expect(within(colNovo).getByText('Carlos Andrade')).toBeInTheDocument();
    expect(within(colNovo).getByText('1')).toBeInTheDocument();
    const colQual = screen.getByTestId('kanban-col-qualified');
    expect(within(colQual).getByText('Juliana Prado')).toBeInTheDocument();
    const colClosing = screen.getByTestId('kanban-col-closing');
    expect(within(colClosing).getByText('Nenhum cliente nesta etapa')).toBeInTheDocument();
    expect(within(colClosing).getByText('0')).toBeInTheDocument();
  });

  it('drag de card chama moveCard com o NOME da etapa (nunca uuid/code)', () => {
    renderScreen();
    const card = screen.getByTestId('pipe-card-l1');
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(screen.getByTestId('kanban-col-qualified'), { dataTransfer: {} });
    expect(m.moveCard).toHaveBeenCalledTimes(1);
    expect(m.moveCard).toHaveBeenCalledWith('l1', 'Qualificado');
    const stageArg = m.moveCard.mock.calls[0][1];
    expect(stageArg).not.toMatch(/^uuid-/);
    expect(stageArg).not.toBe('qualified');
  });
});

// ── B. Caminho remoto válido ─────────────────────────────────────────────

describe('ScreenAndamento — caminho remoto válido', () => {
  it('renderiza as colunas remotas na ordem entregue e agrupa cards por name', () => {
    const reordered = [REMOTE_STAGES[4], REMOTE_STAGES[0], ...REMOTE_STAGES.slice(1, 4)];
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: reordered }));
    renderScreen();
    const grid = screen.getByTestId('kanban-grid');
    const titles = within(grid).getAllByText(/^(Novo|Qualificado|Visita agendada|Em negociação|Fechamento)$/);
    expect(titles.map((el) => el.textContent)).toEqual([
      'Fechamento', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação',
    ]);
    expect(within(screen.getByTestId('kanban-col-new')).getByText('Carlos Andrade')).toBeInTheDocument();
  });

  it('usa o CODE para o tone (não o name) com fallback neutro para code desconhecido', () => {
    const custom = [
      stage('closing', 'Fechamento', 0, true),
      stage('etapa_custom', 'Novo', 1), // name oficial, code desconhecido
    ];
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: custom }));
    renderScreen();
    expect(screen.getByTestId('kanban-tone-closing')).toHaveStyle({ background: '#E8CE72' });
    expect(screen.getByTestId('kanban-tone-etapa_custom')).toHaveStyle({ background: '#8B8B93' });
  });

  it('marca a etapa terminal e não expõe nenhum reorder de coluna', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: REMOTE_STAGES }));
    renderScreen();
    expect(screen.getByTestId('kanban-col-closing')).toHaveAttribute('data-terminal', 'true');
    expect(screen.getByTestId('kanban-col-new')).toHaveAttribute('data-terminal', 'false');
    for (const s of REMOTE_STAGES) {
      expect(screen.getByTestId(`kanban-col-${s.code}`)).not.toHaveAttribute('draggable');
    }
  });
});

// ── C. Loading ───────────────────────────────────────────────────────────

describe('ScreenAndamento — loading remoto', () => {
  it('mostra skeleton sem nenhum stage local durante o loading inicial', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({
      stages: [], isLoading: true, hasData: false,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByText('Fechamento')).toBeNull();
  });
});

// ── D. Erro ──────────────────────────────────────────────────────────────

describe('ScreenAndamento — erro remoto', () => {
  it('erro sem cache mostra mensagem e o retry chama refetch', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({
      stages: [], isError: true, error: new Error('boom'), hasData: false, refetch,
    }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-error');
    expect(state).toHaveTextContent('Não foi possível carregar as etapas do pipeline.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull(); // sem fallback local
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro com dados anteriores mantém as colunas e mostra aviso discreto', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({
      stages: REMOTE_STAGES, isError: true, error: new Error('offline'), hasData: true, refetch,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-grid')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-new')).toBeInTheDocument();
    const warning = screen.getByTestId('kanban-stale-warning');
    expect(warning).toHaveTextContent('Não foi possível atualizar as etapas.');
    fireEvent.click(within(warning).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── E. Configuração incompatível ─────────────────────────────────────────

describe('ScreenAndamento — configError', () => {
  const configError = {
    ok: false as const,
    reason: 'name-mismatch' as const,
    expectedNames: LOCAL_NAMES,
    receivedNames: ['Entrada', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'],
    missingNames: ['Novo'],
    unexpectedNames: ['Entrada'],
    duplicateNames: [],
  };

  it('bloqueia o Kanban sem stages locais e sem detalhes técnicos', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: [], configError, hasData: false }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-config-error');
    expect(state).toHaveTextContent('As etapas da loja não correspondem à configuração esperada.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByText('Entrada')).toBeNull(); // detalhes não vazam pro usuário
    expect(state.textContent).not.toContain('missing');
  });

  it('retry do configError chama refetch', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: [], configError, hasData: false, refetch }));
    renderScreen();
    fireEvent.click(within(screen.getByTestId('kanban-state-config-error')).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── F. Empty remoto ──────────────────────────────────────────────────────

describe('ScreenAndamento — empty remoto real', () => {
  it('mostra a mensagem de nenhuma etapa, sem fallback local', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({ stages: [], isEmpty: true, hasData: false }));
    renderScreen();
    expect(screen.getByTestId('kanban-state-empty')).toHaveTextContent('Nenhuma etapa configurada para sua loja.');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
  });
});

// ── G. Query desabilitada ────────────────────────────────────────────────

describe('ScreenAndamento — query remota desabilitada', () => {
  it('não renderiza stages locais nem inventa erro de rede', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState({
      stages: [], queryEnabled: false, hasData: false,
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-state-disabled')).toHaveTextContent('Sessão indisponível');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull();
    expect(screen.queryByTestId('kanban-state-error')).toBeNull();
  });
});

// ── H. Caminho remoto de Leads (M1-E, E3-B1: remote_active) ────────────────

function remoteLead(id: string, name: string, stageId: string, sellerId: string | null = 's1') {
  return {
    id, name, stage: 'nome-nao-usado-no-agrupamento-remoto', stageId,
    phone: '(11) 90000-0000', car: 'Golf GTI', seller: 'Ana Souza', sellerId,
    urgency: 'green', last: 'ok', alert: 'ok', pay: 'À vista', value: 'R$ 1',
  };
}

function remoteLeadsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function remoteSellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [], sellersById: {}, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function remoteActiveScreenState(over: {
  pipeline?: Partial<Record<string, unknown>>;
  leads?: Partial<Record<string, unknown>>;
  sellerLabels?: Partial<Record<string, unknown>>;
} = {}) {
  return {
    mode: 'remote_active',
    pipeline: hookResult({ stages: REMOTE_STAGES, ...over.pipeline }),
    leads: remoteLeadsResult(over.leads),
    sellerLabels: remoteSellerLabelsResult(over.sellerLabels),
  };
}

describe('ScreenAndamento — remote_active: agrupamento por stageId', () => {
  it('agrupa cards por stageId real — nunca por stage.name (nomes coincidentes não misturam colunas)', () => {
    // Duas leads com o MESMO texto de `stage` (propositalmente errado/estável)
    // mas stageId reais diferentes — só o agrupamento por id pode separá-las.
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: {
        hasData: true, isEmpty: false,
        leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new'), remoteLead('r2', 'Bruno Lima', 'uuid-qualified')],
      },
    }));
    renderScreen();
    expect(within(screen.getByTestId('kanban-col-new')).getByText('Ana Vitória')).toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-col-qualified')).getByText('Bruno Lima')).toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-col-new')).queryByText('Bruno Lima')).toBeNull();
  });

  it('drag fica desabilitado: cards sem draggable, drop nunca chama PipelineService.moveCard', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new')] },
    }));
    renderScreen();
    const card = screen.getByTestId('pipe-card-r1');
    expect(card).toHaveAttribute('draggable', 'false');
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(screen.getByTestId('kanban-col-qualified'), { dataTransfer: {} });
    expect(m.moveCard).not.toHaveBeenCalled();
  });

  // M1-E E4-B2: PipeCard passou a propagar capabilities (não mais o
  // booleano readOnly) — canMoveStage sempre false no E4 (mover Etapa é
  // E5), drag remoto continua impossível.
  it('abrir um card remoto chama __openFlow com capabilities granulares (canMoveStage false)', () => {
    (window as any).__openFlow = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new')] },
    }));
    renderScreen();
    fireEvent.click(screen.getByText('Ana Vitória'));
    expect((window as any).__openFlow).toHaveBeenCalledWith('ver-cliente', expect.objectContaining({
      capabilities: expect.objectContaining({ canMoveStage: false }),
    }));
  });

  it('filtro por vendedor usa sellerLabels remotos, nunca SellerService', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: {
        hasData: true, isEmpty: false,
        leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's1'), remoteLead('r2', 'Bruno Lima', 'uuid-new', 's2')],
      },
      sellerLabels: { hasData: true, isEmpty: false, sellerLabels: [{ seller_id: 's1', name: 'Rótulo Um' }, { seller_id: 's2', name: 'Rótulo Dois' }] },
    }));
    renderScreen();
    fireEvent.click(screen.getByText('Rótulo Dois'));
    expect(within(screen.getByTestId('kanban-col-new')).queryByText('Ana Vitória')).toBeNull();
    expect(within(screen.getByTestId('kanban-col-new')).getByText('Bruno Lima')).toBeInTheDocument();
  });
});

describe('ScreenAndamento — remote_active: estados de Leads', () => {
  it('leads com configError mostra estado sanitizado, sem UUID, com retry', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { configError: { ok: false, code: 'stage_not_found', leadId: 'lead-x' }, refetch },
    }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-leads-config-error');
    expect(state.textContent).not.toContain('lead-x');
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro de leads sem cache mostra estado de erro com retry, sem grid', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { isError: true, isEmpty: false, refetch },
    }));
    renderScreen();
    const state = screen.getByTestId('kanban-state-leads-error');
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    fireEvent.click(within(state).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('leads em loading mostra skeleton próprio, colunas reais nomeadas', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { isLoading: true, isEmpty: false },
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-leads-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
  });

  it('erro de leads com dados anteriores mantém o grid e mostra aviso próprio', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { isError: true, hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new')], refetch },
    }));
    renderScreen();
    expect(screen.getByTestId('kanban-grid')).toBeInTheDocument();
    const warning = screen.getByTestId('kanban-leads-stale-warning');
    fireEvent.click(within(warning).getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenAndamento — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('falha fechada: nenhuma bridge, nenhum dado local, nenhum dado remoto', () => {
    m.useRemoteLeadsScreenState.mockReturnValue({
      mode: 'remote_misconfigured',
      pipeline: localHookResult(), // usePipelineStages real cairia em source:'local' aqui
      leads: remoteLeadsResult(),
      sellerLabels: remoteSellerLabelsResult(),
    });
    renderScreen();
    expect(screen.getByTestId('kanban-state-misconfigured')).toHaveTextContent(
      'As etapas remotas precisam estar disponíveis para carregar os Leads.',
    );
    expect(screen.queryByTestId('kanban-grid')).toBeNull();
    expect(screen.queryByText('Novo')).toBeNull(); // nenhum stage/lead local vaza
    expect(screen.queryByText('Carlos Andrade')).toBeNull();
  });
});

// ── I. Movimento remoto do Kanban (M1-E, E5-B1) ─────────────────────────

function managerUser() {
  return { id: 'user-mgr', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
}

function sellerUser(sellerId: string | null = 's1') {
  return { id: 'user-slr', name: 'Vendedor', email: 's@a.com', activeMembership: { companyId: 'company-a', role: 'seller', sellerId } };
}

function dragAndDrop(cardTestId: string, columnTestId: string) {
  const card = screen.getByTestId(cardTestId);
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
  fireEvent.drop(screen.getByTestId(columnTestId), { dataTransfer: {} });
}

describe('ScreenAndamento — remote_active: movimento remoto (E5-B1, Manager)', () => {
  it('Manager operacional: card draggable, drop em coluna diferente chama attemptMove com leadId/sourceStageId/targetStageId corretos', () => {
    m.user.current = managerUser();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'true');
    dragAndDrop('pipe-card-r1', 'kanban-col-qualified');
    expect(m.attemptMove).toHaveBeenCalledTimes(1);
    expect(m.attemptMove).toHaveBeenCalledWith({ leadId: 'r1', sourceStageId: 'uuid-new', targetStageId: 'uuid-qualified' });
    expect(m.moveCard).not.toHaveBeenCalled();
  });

  it('Manager pode mover Lead de QUALQUER Seller (nenhuma checagem de posse para Manager)', () => {
    m.user.current = managerUser();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    dragAndDrop('pipe-card-r1', 'kanban-col-qualified');
    expect(m.attemptMove).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'r1' }));
  });
});

describe('ScreenAndamento — remote_active: movimento remoto (E5-B1, Seller)', () => {
  it('Seller operacional: pode arrastar o PRÓPRIO Lead', () => {
    m.user.current = sellerUser('s1');
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's1')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'true');
    dragAndDrop('pipe-card-r1', 'kanban-col-qualified');
    expect(m.attemptMove).toHaveBeenCalledWith({ leadId: 'r1', sourceStageId: 'uuid-new', targetStageId: 'uuid-qualified' });
  });

  it('Seller operacional: NÃO pode arrastar Lead de outro Seller', () => {
    m.user.current = sellerUser('s1');
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's2')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'false');
    dragAndDrop('pipe-card-r1', 'kanban-col-qualified');
    expect(m.attemptMove).not.toHaveBeenCalled();
  });

  it('Seller operacional: NÃO pode arrastar Lead sem Seller (sellerId null)', () => {
    m.user.current = sellerUser('s1');
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', null)] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'false');
    dragAndDrop('pipe-card-r1', 'kanban-col-qualified');
    expect(m.attemptMove).not.toHaveBeenCalled();
  });

  it('Seller sem sellerId próprio (capability false): NÃO pode arrastar nem o próprio Lead', () => {
    m.user.current = sellerUser(null);
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', null)] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'false');
  });
});

describe('ScreenAndamento — remote_active: pendência e erro visual (E5-B1)', () => {
  it('Lead pendente: mostra indicação discreta e fica não-arrastável', () => {
    m.user.current = managerUser();
    m.isLeadPending.mockImplementation((leadId: string) => leadId === 'r1');
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-pending-r1')).toBeInTheDocument();
    expect(screen.getByTestId('pipe-card-r1')).toHaveAttribute('draggable', 'false');
  });

  it('Lead com erro: mostra mensagem sanitizada (stage_not_found)', () => {
    m.user.current = managerUser();
    m.errorCodeByLead = { r1: 'remote_leads_mutation_stage_not_found' };
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-error-r1')).toHaveTextContent('A etapa selecionada não está mais disponível.');
  });

  it('Lead com erro forbidden: mensagem sanitizada específica', () => {
    m.user.current = managerUser();
    m.errorCodeByLead = { r1: 'remote_leads_mutation_forbidden' };
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    expect(screen.getByTestId('pipe-card-error-r1')).toHaveTextContent('Você não possui permissão para movimentar este Lead.');
  });

  it('sem erro para o Lead: nenhum elemento de erro renderizado', () => {
    m.user.current = managerUser();
    m.useRemoteLeadsScreenState.mockReturnValue(remoteActiveScreenState({
      leads: { hasData: true, isEmpty: false, leads: [remoteLead('r1', 'Ana Vitória', 'uuid-new', 's9')] },
    }));
    renderScreen();
    expect(screen.queryByTestId('pipe-card-error-r1')).toBeNull();
  });
});
