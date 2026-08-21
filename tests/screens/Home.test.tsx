// Testes de Home (M1-E, E7-A1). Corrige o crash encontrado no E7-A0: Home
// chamava VisitService/DealService/SaleService/TaskService/LeadService.getAll()
// incondicionalmente durante o render, quebrando para QUALQUER papel sob
// REMOTE_LEADS=true (Manager, Seller, Super Admin), inclusive na janela de
// carregamento do snapshot remoto. useRemoteLeadsScreenState é mockado (o
// hook em si já tem cobertura própria via usePipelineStages/useLeads/
// useCurrentCompanySellerLabels) — aqui validamos só o roteamento de Home
// por estado, mesmo padrão de tests/screens/ScreenClientes.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TASK_STATE } from '@/lib/data';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useRemoteTasksScreenState: vi.fn(),
  useRemoteVisitsScreenState: vi.fn(),
  useRemoteDealsScreenState: vi.fn(),
  isLocalCommercialDataAllowed: vi.fn(),
  leadServiceGetAll: vi.fn(),
  visitServiceGetAll: vi.fn(),
  dealServiceGetAll: vi.fn(),
  saleServiceGetAll: vi.fn(),
  taskServiceGetAll: vi.fn(),
  sellerServiceGetAll: vi.fn(),
  sellerServiceGetById: vi.fn(),
  authGetCurrentUser: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

vi.mock('@/lib/hooks/useRemoteTasksScreenState', () => ({
  useRemoteTasksScreenState: m.useRemoteTasksScreenState,
}));

vi.mock('@/lib/hooks/useRemoteVisitsScreenState', () => ({
  useRemoteVisitsScreenState: m.useRemoteVisitsScreenState,
}));

vi.mock('@/lib/hooks/useRemoteDealsScreenState', () => ({
  useRemoteDealsScreenState: m.useRemoteDealsScreenState,
}));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: m.authGetCurrentUser },
  SellerService: { getAll: m.sellerServiceGetAll, getById: m.sellerServiceGetById },
  LeadService: { getAll: m.leadServiceGetAll },
  VisitService: { getAll: m.visitServiceGetAll },
  DealService: { getAll: m.dealServiceGetAll },
  SaleService: { getAll: m.saleServiceGetAll },
  TaskService: { getAll: m.taskServiceGetAll },
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

import { Home } from '@/components/screens/Home';

function manager() {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
}

function seller(sellerId: string | null = 's1') {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId },
  };
}

function superAdmin() {
  return { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
}

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true, queryKey: [],
    stages: [], byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...over,
  };
}

function sellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [], sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
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

// COMMERCIAL-REMOTE-B1-B3-G — resultado padrão de useRemoteTasksScreenState,
// mesmo formato de screenState acima, próprio de Tasks (mode/tasks/isLoading/
// isFetching/isError/error/configError/isEmpty/hasData/refetch).
function taskScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode,
    tasks: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

// COMMERCIAL-REMOTE-VISITS-B7 — resultado padrão de
// useRemoteVisitsScreenState, mesmo formato de taskScreenState acima,
// próprio de Visits (mode/visits/isLoading/isFetching/isError/error/
// configError/isEmpty/hasData/refetch).
function visitScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode,
    visits: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

// COMMERCIAL-REMOTE-DEALS-B7-B1 — resultado padrão de
// useRemoteDealsScreenState, mesmo formato de taskScreenState/
// visitScreenState acima, próprio de Deals (mode/deals/isLoading/
// isFetching/isError/error/configError/isEmpty/hasData/refetch).
function dealScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode,
    deals: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

// variant 'B' evita o caminho FitBox/ResizeObserver do Podium (fora do
// escopo do E7-A1 — ResizeObserver não existe no jsdom por padrão e nenhum
// teste no projeto ainda exercitava o render real de Home/Podium).
function renderHome(currentUser: any) {
  return render(<Home t={{ podium: 'B' }} setTweak={vi.fn()} go={vi.fn()} active={false} currentUser={currentUser} />);
}

// Podium (components/podiums/Podiums.tsx, fora do escopo do E7-A1) espera
// pelo menos 3 sellers para montar o pódio — não relacionado ao crash desta
// etapa; supre 3 sellers mínimos para o Podium/Ranking (SellerService,
// intocado nesta etapa) não quebrar por conta própria durante os testes.
const DEFAULT_SELLERS = [
  { id: 's1', name: 'Marcos Silva', first: 'Marcos', team: 'Seminovos', leads: 10, scheduled: 2, visits: 5, sales: 8, conv: 40, move: 0 },
  { id: 's2', name: 'Ana Souza', first: 'Ana', team: 'Novos', leads: 8, scheduled: 1, visits: 4, sales: 6, conv: 35, move: 1 },
  { id: 's3', name: 'João Ferreira', first: 'João', team: 'Novos', leads: 6, scheduled: 1, visits: 3, sales: 4, conv: 30, move: -1 },
];

beforeEach(() => {
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.visitServiceGetAll.mockReset().mockReturnValue([]);
  m.dealServiceGetAll.mockReset().mockReturnValue([]);
  m.saleServiceGetAll.mockReset().mockReturnValue([]);
  m.taskServiceGetAll.mockReset().mockReturnValue([]);
  m.sellerServiceGetAll.mockReset().mockReturnValue(DEFAULT_SELLERS);
  m.sellerServiceGetById.mockReset().mockReturnValue(null);
  m.authGetCurrentUser.mockReset().mockReturnValue(manager());
  m.useRemoteLeadsScreenState.mockReset();
  // Default true (equivalente a REMOTE_LEADS=false real) preserva o
  // comportamento de todos os testes existentes, escritos antes do E7-B1 —
  // só os testes da seção "Podium/Ranking em modo remoto" abaixo
  // sobrescrevem para false.
  m.isLocalCommercialDataAllowed.mockReset().mockReturnValue(true);
  // COMMERCIAL-REMOTE-B1-B3-G — default 'task_local', espelha o default de
  // isLocalCommercialDataAllowed=true acima: preserva o baseline local de
  // todos os testes escritos antes do G. Toda describe com Leads remoto
  // sobrescreve para um mode não-local próprio (nunca 'task_local' junto de
  // Leads remoto — violaria a garantia estrutural de resolveTaskRemoteMode()).
  m.useRemoteTasksScreenState.mockReset().mockReturnValue(taskScreenState('task_local'));
  // COMMERCIAL-REMOTE-VISITS-B7 — default 'visit_local', mesmo raciocínio
  // do default de Tasks acima: preserva o baseline local de todos os
  // testes escritos antes do B7. Toda describe com Leads remoto sobrescreve
  // para um mode não-local próprio (nunca 'visit_local' junto de Leads
  // remoto — violaria a garantia estrutural de resolveVisitRemoteMode()).
  m.useRemoteVisitsScreenState.mockReset().mockReturnValue(visitScreenState('visit_local'));
  // COMMERCIAL-REMOTE-DEALS-B7-B1 — default 'deal_local', mesmo raciocínio
  // do default de Tasks/Visits acima: preserva o baseline local de todos os
  // testes escritos antes do B7-B1. Toda describe com Leads remoto
  // sobrescreve para um mode não-local próprio (nunca 'deal_local' junto de
  // Leads remoto — violaria a garantia estrutural de resolveDealRemoteMode()).
  m.useRemoteDealsScreenState.mockReset().mockReturnValue(dealScreenState('deal_local'));
});

// ── A. Home local ────────────────────────────────────────────────────────
describe('Home — caminho local (REMOTE_LEADS=false)', () => {
  it('usa os serviços locais normalmente, sem regressão', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.leadServiceGetAll.mockReturnValue([{ id: 'l1', urgency: 'red' }]);
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: 'late' }]);
    renderHome(manager());
    expect(m.leadServiceGetAll).toHaveBeenCalled();
    expect(m.taskServiceGetAll).toHaveBeenCalled();
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    expect(screen.getByText('visitas não confirmadas')).toBeInTheDocument();
    expect(screen.getByText('propostas aguardando aprovação')).toBeInTheDocument();
    expect(screen.getByText('pendências atrasadas')).toBeInTheDocument();
    expect(screen.getByText('Funil de conversão')).toBeInTheDocument();
    expect(screen.getByText('Vendas')).toBeInTheDocument();
    // M1-E E7-B1: Podium/Ranking/MinhaDisputa (SellerService) continuam
    // aparecendo integralmente no modo local — nenhum redesign, nenhuma
    // mudança de comportamento.
    expect(m.sellerServiceGetAll).toHaveBeenCalled();
    expect(screen.getByText('PÓDIO DE CAMPEÕES')).toBeInTheDocument();
    expect(screen.getByText('Ranking completo')).toBeInTheDocument();
    expect(screen.getByText('Minha disputa')).toBeInTheDocument();
  });

  // COMMERCIAL-REMOTE-VISITS-B7 — visitsSummary.status==='local' preserva
  // exatamente a semântica legada: só VISIT_STATUS.PENDING ('pendente')
  // conta como "não confirmada" — 'agendada' (SCHEDULED, sem confirmação
  // necessária) nunca entra, mesma distinção que já existia antes do B7.
  it('visitas não confirmadas conta só VISIT_STATUS.PENDING, nunca SCHEDULED/outros', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.visitServiceGetAll.mockReturnValue([
      { id: 'v1', status: 'pendente' },
      { id: 'v2', status: 'pendente' },
      { id: 'v3', status: 'agendada' },
      { id: 'v4', status: 'confirmada' },
    ]);
    renderHome(manager());
    const card = screen.getByText('visitas não confirmadas').closest('button');
    expect(card?.textContent).toContain('2');
  });
});

// ── Podium/Ranking/MinhaDisputa em modo remoto (M1-E E7-B1) ─────────────
// Achado do E7-A0: SellerService (catálogo local, sem company_id, sem
// backend remoto) era chamado incondicionalmente por Home — Podium/Ranking/
// MinhaDisputa exibiam vendedores de demonstração mesmo numa empresa
// remota real. Corrigido nesta etapa: fora do modo local, a seção inteira
// vira um estado indisponível explícito, sem nenhuma leitura de
// SellerService.
describe('Home — Podium/Ranking/MinhaDisputa em modo remoto (E7-B1)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    // COMMERCIAL-REMOTE-B1-B3-G — Leads remoto ⟹ Tasks nunca 'task_local'
    // (garantia estrutural de resolveTaskRemoteMode()); esta suíte não
    // testa Tasks especificamente, então usa 'unavailable' — sem card, sem
    // TaskService.getAll.
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-VISITS-B7 — mesma garantia estrutural para Visits:
    // Leads remoto ⟹ Visits nunca 'visit_local'. Esta suíte não testa
    // Visits especificamente, então usa 'unavailable'.
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-DEALS-B7-B1 — mesma garantia estrutural para Deals:
    // Leads remoto ⟹ Deals nunca 'deal_local'. Esta suíte não testa Deals
    // especificamente, então usa 'unavailable'.
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  it('nunca chama SellerService.getAll/getById', () => {
    renderHome(manager());
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });

  it('nenhum vendedor de demonstração (DEFAULT_SELLER/catálogo local) aparece', () => {
    renderHome(manager());
    expect(screen.queryByText('Marcos Silva')).toBeNull();
    expect(screen.queryByText('Ana Souza')).toBeNull();
    expect(screen.queryByText('Equipe')).toBeNull(); // DEFAULT_SELLER.name
  });

  it('pódio/ranking somem, estado indisponível explícito aparece no lugar', () => {
    renderHome(manager());
    expect(screen.queryByText('PÓDIO DE CAMPEÕES')).toBeNull();
    expect(screen.queryByText('Ranking completo')).toBeNull();
    expect(screen.queryByText('Minha disputa')).toBeNull();
    expect(screen.getByText('Pódio de campeões')).toBeInTheDocument();
    expect(screen.getByText('Ranking e desempenho de vendedores serão disponibilizados após a migração deste módulo.')).toBeInTheDocument();
  });

  it('widgets de Leads remotos (fora do escopo de Sellers) continuam funcionando normalmente', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    renderHome(manager());
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
  });
});

// ── B/C. Home remote_active — Manager e Seller ──────────────────────────
describe('Home — remote_active (Manager e Seller)', () => {
  beforeEach(() => {
    // COMMERCIAL-REMOTE-B1-B3-G — mesma garantia estrutural da suíte
    // acima: Leads remoto nunca convive com Tasks 'task_local'.
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-VISITS-B7 — idem para Visits: Leads remoto nunca
    // convive com Visits 'visit_local'.
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-DEALS-B7-B1 — idem para Deals: Leads remoto nunca
    // convive com Deals 'deal_local'.
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  it.each([['Manager', manager()], ['Seller', seller('s1')]])('%s: nunca chama serviços locais bloqueados nem LeadService.getAll(), usa a fonte remota', (_label, user) => {
    m.authGetCurrentUser.mockReturnValue(user);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }, { id: 'r2', urgency: 'green' }] },
      }),
    );
    renderHome(user);
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('sucesso renderiza o widget de Leads permitido com a contagem real', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', {
        leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }, { id: 'r2', urgency: 'green' }] },
      }),
    );
    renderHome(manager());
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    // "1" (delayedLeads) também coincide com a posição #1 do Ranking — a
    // contagem real já é provada pelo count na UrgentAttentionGrid.
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    // "Leads" também aparece nas colunas do Ranking (SellerService, fora do
    // escopo desta etapa) — verifica só que a etapa do funil está presente.
    expect(screen.getAllByText('Leads').length).toBeGreaterThan(0);
  });

  it('widgets Visit/Deal/Task/Sale ficam indisponíveis, nunca mostram zero como dado real', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    renderHome(manager());
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(screen.queryByText('propostas aguardando aprovação')).toBeNull();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    // "Visitas" não é verificado aqui: também aparece como coluna do
    // Ranking (SellerService, fora do escopo desta etapa) — "Propostas"/
    // "Vendas" são exclusivos do funil e já provam o padrão de ocultação.
    expect(screen.queryByText('Propostas')).toBeNull();
    expect(screen.queryByText('Vendas')).toBeNull();
  });
});

// ── D. Super Admin sem contexto comercial ───────────────────────────────
describe('Home — Super Admin sem companyId operacional', () => {
  it('nenhum serviço comercial local, nenhum LeadService.getAll(), estado neutro, nenhum crash', () => {
    m.authGetCurrentUser.mockReturnValue(superAdmin());
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    renderHome(superAdmin());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(screen.getAllByText('Métricas comerciais indisponíveis nesta sessão.').length).toBeGreaterThan(0);
  });
});

// ── E. remote_misconfigured ─────────────────────────────────────────────
describe('Home — remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false)', () => {
  it('fail-closed: nenhuma chamada local, nenhum crash', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_misconfigured'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_misconfigured'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_misconfigured'));
    renderHome(manager());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(screen.getAllByText('Métricas comerciais indisponíveis nesta sessão.').length).toBeGreaterThan(0);
  });
});

// ── F. Snapshot/query ainda carregando ──────────────────────────────────
describe('Home — remote_active, ainda carregando', () => {
  beforeEach(() => {
    // COMMERCIAL-REMOTE-B1-B3-G/B7/B7-B1 — mesma garantia estrutural das
    // suítes remotas acima; estes testes cobrem só o estado de Leads.
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  it('stages carregando: estado de loading seguro, nenhum acesso síncrono ao snapshot, nenhum throw', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { pipeline: { hasData: false, isLoading: true } }),
    );
    expect(() => renderHome(manager())).not.toThrow();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(screen.getAllByText('Carregando…').length).toBeGreaterThan(0);
  });

  it('leads carregando (stages já prontos): estado de loading seguro, nenhum throw', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isLoading: true, isEmpty: false } }),
    );
    expect(() => renderHome(manager())).not.toThrow();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(screen.getAllByText('Carregando…').length).toBeGreaterThan(0);
  });

  it('erro de leads: estado sanitizado com retry, sem detalhe técnico', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    renderHome(manager());
    expect(screen.getAllByText(/Não foi possível/).length).toBeGreaterThan(0);
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });
});

// ── G. Home Task Summary remoto (COMMERCIAL-REMOTE-B1-B3-G) ─────────────
// useHomeTasksSummary substitui o proxy leadsSummary.status por
// resolveTaskRemoteMode() (via useRemoteTasksScreenState) — Leads e Tasks
// passam a ter estados totalmente independentes dentro de UrgentAttention.
describe('Home — Task summary remoto (independente de Leads)', () => {
  beforeEach(() => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    // COMMERCIAL-REMOTE-VISITS-B7 — esta suíte cobre só a independência de
    // Tasks; Visits usa 'unavailable' (garantia estrutural: Leads remoto
    // nunca convive com 'visit_local').
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-DEALS-B7-B1 — idem para Deals: Leads remoto nunca
    // convive com 'deal_local'.
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  it('99 Tasks locais vs 2 remotas atrasadas: Home mostra 2, TaskService.getAll nunca é chamado no branch remoto', () => {
    m.taskServiceGetAll.mockReturnValue(Array.from({ length: 99 }, (_, i) => ({ id: `local-${i}`, state: TASK_STATE.LATE })));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [
        { id: 'r1', state: TASK_STATE.LATE },
        { id: 'r2', state: TASK_STATE.LATE },
        { id: 'r3', state: TASK_STATE.TODAY },
      ],
    }));
    renderHome(manager());
    const card = screen.getByText('pendências atrasadas').closest('button');
    expect(card?.textContent).toContain('2');
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('loading: nenhuma contagem local, notice dedicado de Tasks', () => {
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    renderHome(manager());
    expect(screen.getByText('Carregando pendências…')).toBeInTheDocument();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('erro: mensagem sanitizada com retry, sem fallback local', () => {
    const refetch = vi.fn();
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isError: true, refetch }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as pendências.')).toBeInTheDocument();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('configError: unavailable, sem contagem parcial', () => {
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { configError: { code: 'x' } as any }));
    renderHome(manager());
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(screen.queryByText('Carregando pendências…')).toBeNull();
    expect(screen.queryByText('Não foi possível carregar as pendências.')).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it.each(['task_blocked', 'task_remote_misconfigured', 'task_remote_unavailable_identity'])(
    '%s: unavailable, TaskService.getAll nunca chamado',
    (mode) => {
      m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
      m.useRemoteTasksScreenState.mockReturnValue(taskScreenState(mode));
      renderHome(manager());
      expect(screen.queryByText('pendências atrasadas')).toBeNull();
      expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    },
  );

  it('lateCount=0 é sucesso (ready), não indisponibilidade', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    renderHome(manager());
    const card = screen.getByText('pendências atrasadas').closest('button');
    expect(card?.textContent).toContain('0');
  });

  it('independência A: Leads ready + Tasks loading — Leads normal, Tasks em loading', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    renderHome(manager());
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    expect(screen.getByText('Carregando pendências…')).toBeInTheDocument();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
  });

  it('independência B: Leads error + Tasks ready — Task summary continua disponível', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [{ id: 'r1', state: TASK_STATE.LATE }],
    }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as métricas.')).toBeInTheDocument();
    const card = screen.getByText('pendências atrasadas').closest('button');
    expect(card?.textContent).toContain('1');
  });

  it('independência C: Leads ready + Tasks error — Leads normal, Tasks em erro', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isError: true, refetch }));
    renderHome(manager());
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar as pendências.')).toBeInTheDocument();
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('transição local → remote loading: contagem local some imediatamente, sem stale', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_local'));
    // Estrutural: 'local' de Leads no primeiro render implica 'visit_local'
    // (resolveVisitRemoteMode()) — mesmo raciocínio já aplicado a Tasks
    // acima, nunca fabricar uma combinação impossível (R1).
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_local'));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    const props: any = { t: { podium: 'B' }, setTweak: vi.fn(), go: vi.fn(), active: false, currentUser: manager() };
    const { rerender } = render(<Home {...props} />);
    expect(screen.getByText('pendências atrasadas')).toBeInTheDocument();

    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    rerender(<Home {...props} />);

    expect(screen.getByText('Carregando pendências…')).toBeInTheDocument();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
  });
});

// ── H. Gate de Tasks é SEMPRE tasksSummary, nunca leadsSummary (R1) ─────
// COMMERCIAL-REMOTE-B1-B3-G-R1 — "Leads local ⟹ Task local" é falso
// quando REMOTE_TASKS=true e REMOTE_LEADS=false: resolveTaskRemoteMode()
// retorna 'task_remote_misconfigured' nesse caso (não 'task_local'). O
// G-EXEC tinha, por engano, deixado o item de Tasks dentro do branch
// leadsSummary.status==='local'. Esta suíte prova que o gate real agora é
// tasksSummary, independente do valor de leadsSummary.
describe('Home — Leads local + Tasks não-local (R1, gate correto)', () => {
  it('Leads local + Tasks unavailable (misconfigured): TaskService.getAll 0 calls, nenhuma pendência mostrada, Leads/Visitas/Propostas locais continuam', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_misconfigured'));
    m.taskServiceGetAll.mockReturnValue(Array.from({ length: 99 }, (_, i) => ({ id: `local-${i}`, state: TASK_STATE.LATE })));
    m.leadServiceGetAll.mockReturnValue([{ id: 'l1', urgency: 'red' }]);
    renderHome(manager());
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    expect(screen.getByText('visitas não confirmadas')).toBeInTheDocument();
    expect(screen.getByText('propostas aguardando aprovação')).toBeInTheDocument();
  });

  it('Leads local + Tasks loading: TaskService.getAll 0 calls, notice de carregando, Leads locais continuam', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    renderHome(manager());
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(screen.getByText('Carregando pendências…')).toBeInTheDocument();
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
  });

  it('Leads local + Tasks local (real): TaskService.getAll chamado, contagem local preservada', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_local'));
    m.taskServiceGetAll.mockReturnValue([
      { id: 't1', state: TASK_STATE.LATE },
      { id: 't2', state: TASK_STATE.LATE },
    ]);
    renderHome(manager());
    expect(m.taskServiceGetAll).toHaveBeenCalled();
    const card = screen.getByText('pendências atrasadas').closest('button');
    expect(card?.textContent).toContain('2');
  });

  // Inversa (Leads não-local + Tasks local) é estruturalmente impossível:
  // task_local só existe quando resolveRemoteLeadsFlagMode()==='local'
  // (lib/tasks/remoteTasksMode.ts:60) — e leadsSummary.status só é
  // diferente de 'local' quando o mode do hook de Leads já não é 'local'.
  // Nenhum fixture dessa combinação é criado (instrução explícita do R1 —
  // não fabricar estado impossível).
});

// ── I. Home Visits Summary remoto (COMMERCIAL-REMOTE-VISITS-B7) ────────
// useHomeVisitsSummary substitui a antiga dependência de
// leadsSummary.status==='local' pelo modo remoto próprio de Visits
// (resolveVisitRemoteMode(), via useRemoteVisitsScreenState) — Leads e
// Visits passam a ter estados totalmente independentes dentro de
// UrgentAttention/ConversionFunnel, mesmo padrão já provado para Tasks na
// Seção G. Definições de unconfirmedCount/openCount congeladas no
// B7-PRECHECK §9/§10 (só RemoteVisitModel/status, sem now/scheduledAt).
describe('Home — Visits summary remoto (independente de Leads)', () => {
  function remoteVisit(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'v1', status: 'scheduled', ...over };
  }

  beforeEach(() => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    // COMMERCIAL-REMOTE-DEALS-B7-B1 — idem para Deals: Leads remoto nunca
    // convive com 'deal_local'. Esta suíte não testa Deals especificamente.
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    // Podium/Ranking/MinhaDisputa (SellerService) reproduzem os mesmos
    // labels de coluna "Leads"/"Visitas" (Col, Home.tsx) — desligado aqui
    // para isolar as asserções desta suíte dos dois cards reais de Visits,
    // fora do escopo de Sellers/Podium (E7-B1, já coberto na sua própria
    // suíte acima).
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
  });

  it('snapshot [scheduled, scheduled, confirmed, completed, canceled]: card mostra 2 não confirmadas, funil mostra 3 em aberto — completed/canceled nunca contam', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [
        remoteVisit({ id: 'v1', status: 'scheduled' }),
        remoteVisit({ id: 'v2', status: 'scheduled' }),
        remoteVisit({ id: 'v3', status: 'confirmed' }),
        remoteVisit({ id: 'v4', status: 'completed' }),
        remoteVisit({ id: 'v5', status: 'canceled' }),
      ],
    }));
    renderHome(manager());
    const card = screen.getByText('visitas não confirmadas').closest('button');
    expect(card?.textContent).toContain('2');
    const funnelStage = screen.getByText('Visitas').closest('.lift');
    expect(funnelStage?.textContent).toContain('3');
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller: conta somente o snapshot já RLS-scoped recebido, nenhum SellerService necessário', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [remoteVisit({ id: 'v1', status: 'scheduled' })],
    }));
    renderHome(seller('s1'));
    const card = screen.getByText('visitas não confirmadas').closest('button');
    expect(card?.textContent).toContain('1');
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('loading: nenhuma contagem local, notice dedicado de Visits', () => {
    m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isLoading: true }));
    renderHome(manager());
    expect(screen.getByText('Carregando visitas…')).toBeInTheDocument();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
  });

  it('erro: mensagem sanitizada com retry, sem fallback local', () => {
    const refetch = vi.fn();
    m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isError: true, refetch }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as visitas.')).toBeInTheDocument();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('configError: unavailable, sem contagem parcial', () => {
    m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { configError: { code: 'x' } as any }));
    renderHome(manager());
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(screen.queryByText('Carregando visitas…')).toBeNull();
    expect(screen.queryByText('Não foi possível carregar as visitas.')).toBeNull();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
  });

  it.each(['visit_blocked', 'visit_remote_misconfigured', 'visit_remote_unavailable_identity'])(
    '%s: unavailable, VisitService.getAll nunca chamado, nenhum zero falso',
    (mode) => {
      m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState(mode));
      renderHome(manager());
      expect(screen.queryByText('visitas não confirmadas')).toBeNull();
      expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    },
  );

  it('unconfirmedCount=0 é sucesso (ready), não indisponibilidade', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: false, isEmpty: true, visits: [] }));
    renderHome(manager());
    const card = screen.getByText('visitas não confirmadas').closest('button');
    expect(card?.textContent).toContain('0');
  });

  it('independência A: Leads ready + Visits blocked — Leads normal, Visits some sem zero falso', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_blocked'));
    renderHome(manager());
    expect(screen.getByText('leads atrasados')).toBeInTheDocument();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
  });

  it('independência B: Leads error + Visits ready — Visits summary continua disponível', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ status: 'scheduled' })],
    }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as métricas.')).toBeInTheDocument();
    const card = screen.getByText('visitas não confirmadas').closest('button');
    expect(card?.textContent).toContain('1');
  });

  it('funil: Leads + Visitas presentes quando ambos válidos, sem Propostas/Vendas locais', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [remoteVisit({ status: 'scheduled' }), remoteVisit({ status: 'confirmed' })],
    }));
    renderHome(manager());
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Visitas')).toBeInTheDocument();
    expect(screen.queryByText('Propostas')).toBeNull();
    expect(screen.queryByText('Vendas')).toBeNull();
  });

  it('funil: Visits unavailable — Leads continua, stage Visitas omitido (nunca zero)', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_misconfigured'));
    renderHome(manager());
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.queryByText('Visitas')).toBeNull();
  });

  it('nenhuma nova superfície "Pendentes de resultado" é criada na Home', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [remoteVisit({ status: 'scheduled' }), remoteVisit({ status: 'confirmed' })],
    }));
    renderHome(manager());
    expect(screen.queryByText(/Pendentes de resultado/)).toBeNull();
  });
});

// ── J. Home Deals Summary remoto (COMMERCIAL-REMOTE-DEALS-B7-B1) ───────
// useHomeDealsSummary substitui a ausência total de Deals na Home por um
// resumo próprio, independente de leadsSummary/tasksSummary/visitsSummary
// (mesmo padrão de Tasks/Visits nas seções G/I — B7-B-PRECHECK §5). Único
// dado exposto: openCount (status==='open' exclusivamente) — nenhum
// agrupamento por Seller (isso é B7-B2, fora de escopo aqui).
describe('Home — Deals summary remoto (independente de Leads/Tasks/Visits)', () => {
  function remoteDeal(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'd1', status: 'open', assignedSellerId: 's1', ...over };
  }

  beforeEach(() => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    // Desligado para isolar as asserções desta suíte do Ranking (mesma
    // razão da suíte de Visits acima — Podium/Ranking fora de escopo).
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
  });

  it('4 Deals [open, open, lost, sold]: openCount=2, terminal statuses nunca contam', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'd1', status: 'open' }),
        remoteDeal({ id: 'd2', status: 'open' }),
        remoteDeal({ id: 'd3', status: 'lost' }),
        remoteDeal({ id: 'd4', status: 'sold' }),
      ],
    }));
    renderHome(manager());
    const card = screen.getByText('negociações em andamento').closest('button');
    expect(card?.textContent).toContain('2');
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller: conta somente o snapshot já RLS-scoped recebido, nenhum filtro de empresa no frontend', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDeal({ id: 'd1', status: 'open', assignedSellerId: 's1' })],
    }));
    renderHome(seller('s1'));
    const card = screen.getByText('negociações em andamento').closest('button');
    expect(card?.textContent).toContain('1');
  });

  it('Manager: conta o conjunto company-wide recebido, sem agrupar por Seller', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'd1', status: 'open', assignedSellerId: 's1' }),
        remoteDeal({ id: 'd2', status: 'open', assignedSellerId: 's2' }),
        remoteDeal({ id: 'd3', status: 'open', assignedSellerId: 's3' }),
      ],
    }));
    renderHome(manager());
    const card = screen.getByText('negociações em andamento').closest('button');
    expect(card?.textContent).toContain('3');
    // Prova de "nenhum agrupamento por Seller ainda" (B7-B2, fora de
    // escopo): só um card de Negociações existe, nenhum nome de Seller
    // aparece associado a uma contagem individual.
    expect(screen.getAllByText('negociações em andamento').length).toBe(1);
  });

  it('openCount=0 é sucesso (ready), não indisponibilidade', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: false, isEmpty: true, deals: [] }));
    renderHome(manager());
    const card = screen.getByText('negociações em andamento').closest('button');
    expect(card?.textContent).toContain('0');
  });

  it('loading: nenhuma contagem falsa, notice dedicado de Negociações', () => {
    m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isLoading: true }));
    renderHome(manager());
    expect(screen.getByText('Carregando negociações…')).toBeInTheDocument();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  it('erro: mensagem sanitizada com retry, sem fallback local, sem detalhe técnico', () => {
    const refetch = vi.fn();
    m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isError: true, refetch }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as negociações.')).toBeInTheDocument();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText(/supabase/i)).toBeNull();
    expect(screen.queryByText(/RLS/)).toBeNull();
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('configError: unavailable, sem contagem parcial', () => {
    m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { configError: { code: 'x' } as any }));
    renderHome(manager());
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(screen.queryByText('Carregando negociações…')).toBeNull();
    expect(screen.queryByText('Não foi possível carregar as negociações.')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  // 'deal_blocked' reproduz o rollout atual: NEXT_PUBLIC_FF_REMOTE_DEALS
  // OFF com Leads já remote_ready (lib/deals/remoteDealsMode.ts) — nunca
  // tratado como erro, célula simplesmente ausente, nenhum DealService novo.
  it.each(['deal_blocked', 'deal_remote_misconfigured', 'deal_remote_unavailable_identity'])(
    '%s: unavailable, DealService.getAll nunca chamado, nenhum zero falso',
    (mode) => {
      m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
      m.useRemoteDealsScreenState.mockReturnValue(dealScreenState(mode));
      renderHome(manager());
      expect(screen.queryByText('negociações em andamento')).toBeNull();
      expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    },
  );

  it('click em "Negociações em andamento" navega para go(\'propostas\'), nunca abre flow', () => {
    const go = vi.fn();
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDeal({ id: 'd1', status: 'open' })],
    }));
    const props: any = { t: { podium: 'B' }, setTweak: vi.fn(), go, active: false, currentUser: manager() };
    render(<Home {...props} />);
    fireEvent.click(screen.getByText('negociações em andamento'));
    expect(go).toHaveBeenCalledWith('propostas');
  });

  it('independência: Leads error + Deals ready — Deals summary continua disponível', () => {
    const refetch = vi.fn();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch } }),
    );
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ id: 'd1', status: 'open' })],
    }));
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar as métricas.')).toBeInTheDocument();
    const card = screen.getByText('negociações em andamento').closest('button');
    expect(card?.textContent).toContain('1');
  });

  it('nenhuma linguagem de aprovação/relação Task-Deal na nova seção remota', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDeal({ id: 'd1', status: 'open' })],
    }));
    renderHome(manager());
    expect(screen.queryByText(/Negociações sem acompanhamento/)).toBeNull();
    expect(screen.queryByText(/Negociações paradas/)).toBeNull();
    expect(screen.queryByText(/Aguardando aprovação/)).toBeNull();
    expect(screen.queryByText(/^Aprovar$/)).toBeNull();
    expect(screen.queryByText(/Desconto pendente/)).toBeNull();
  });
});

// ── K. Home Deals — modo local / flag OFF (regressão) ───────────────────
describe('Home — Deals summary local/OFF preserva o legado (COMMERCIAL-REMOTE-DEALS-B7-B1)', () => {
  it('Leads local: card legado "propostas aguardando aprovação" continua, "Negociações em andamento" NUNCA aparece', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    renderHome(manager());
    expect(screen.getByText('propostas aguardando aprovação')).toBeInTheDocument();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
  });

  it('Home local completa (Podium/Ranking/MinhaDisputa/QuickActions) permanece intacta com Deals summary sempre chamado', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    renderHome(manager());
    expect(screen.getByText('PÓDIO DE CAMPEÕES')).toBeInTheDocument();
    expect(screen.getByText('Ranking completo')).toBeInTheDocument();
    expect(screen.getByText('Minha disputa')).toBeInTheDocument();
    expect(screen.getByText('Ações rápidas')).toBeInTheDocument();
  });
});
