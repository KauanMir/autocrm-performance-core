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
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TASK_STATE } from '@/lib/data';

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useRemoteTasksScreenState: vi.fn(),
  useRemoteVisitsScreenState: vi.fn(),
  useRemoteDealsScreenState: vi.fn(),
  useRemoteSalesScreenState: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  useCurrentCompanyTimezone: vi.fn(),
  useCompanySellerLeaderboard: vi.fn(),
  useSellerCompetitionEvents: vi.fn(),
  useMarkCompetitionEventsSeen: vi.fn(),
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

vi.mock('@/lib/hooks/useRemoteSalesScreenState', () => ({
  useRemoteSalesScreenState: m.useRemoteSalesScreenState,
}));

vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: m.useCurrentCompanySellerLabels,
}));

// HOME-FILTERS-R1-EXEC — mockado como todo hook remoto irmão (useQuery real
// exige QueryClientProvider, ausente neste harness de teste — mesmo motivo
// de useCurrentCompanySellerLabels/useRemoteSalesScreenState acima).
vi.mock('@/lib/hooks/useCurrentCompanyTimezone', () => ({
  useCurrentCompanyTimezone: m.useCurrentCompanyTimezone,
}));

// PODIUM-COMPETITION-R1-EXEC — mesmo motivo de useCurrentCompanyTimezone
// acima: useQuery real exige QueryClientProvider, ausente neste harness.
// Cobertura própria do hook em si (loading/error/empty/ready, cascade de
// período, query key) fica em tests/hooks/useCompanySellerLeaderboard.test.tsx
// — aqui só se valida o que Home FAZ com o resultado.
vi.mock('@/lib/hooks/useCompanySellerLeaderboard', () => ({
  useCompanySellerLeaderboard: m.useCompanySellerLeaderboard,
}));

// PODIUM-COMPETITION-R2B-B1-EXEC — mesmo motivo de useCompanySellerLeaderboard
// acima: useQuery real exige QueryClientProvider, ausente neste harness.
// Cobertura própria dos hooks fica em tests/hooks/useSellerCompetitionEvents.test.tsx
// e tests/hooks/useMarkCompetitionEventsSeen.test.tsx — aqui só se valida o
// que Home FAZ com o resultado (mostra/esconde a comemoração, marca visto).
vi.mock('@/lib/hooks/useSellerCompetitionEvents', () => ({
  useSellerCompetitionEvents: m.useSellerCompetitionEvents,
}));
vi.mock('@/lib/hooks/useMarkCompetitionEventsSeen', () => ({
  useMarkCompetitionEventsSeen: m.useMarkCompetitionEventsSeen,
}));

// PODIUM-COMPETITION-R1-EXEC — fixa a preferência remota em 'B' (mesmo
// motivo do comentário sobre variant 'B' em renderHome mais abaixo: A/C/D
// passam pelo caminho FitBox/ResizeObserver, ausente no jsdom, fora do
// escopo desta suíte). Cobertura própria de leitura/escrita/validação da
// preferência (default D, fallback em valor inválido, isolamento por
// userId) fica em lib/podium/podiumViewPreference — puro, sem React, já
// testável sem esta mock.
vi.mock('@/lib/hooks/usePodiumViewPreference', () => ({
  usePodiumViewPreference: () => ['B', vi.fn()],
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

// HOME-PODIUM-R1-EXEC — resultado padrão de useRemoteSalesScreenState
// (assinatura real, lib/hooks/useRemoteSalesScreenState.ts), mesmo formato
// de taskScreenState/visitScreenState/dealScreenState acima, já provado em
// tests/screens/ScreenResultadosRemote.test.tsx.
function saleScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, sales: [] as any[], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

// COMMERCIAL-REMOTE-DEALS-B7-B2 — resultado padrão de
// useCurrentCompanySellerLabels (assinatura real, lib/hooks/
// useCurrentCompanySellerLabels.ts), usado pela seção Manager para
// resolver sellerId → nome sem N+1.
function currentCompanySellerLabelsResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [], sellersById: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

// PODIUM-COMPETITION-R1-EXEC — quando o roster tem <=3 sellers, TODOS eles
// caem dentro do Top 3 e aparecem 2x no DOM (Pódio + RankingList) — getByText
// simples fica ambíguo. Escopa a busca só na RankingList (o texto "Ranking
// completo" é único, seu container-pai é a lista inteira).
function getRankingListContainer() {
  return screen.getByText('Ranking completo').closest('div')!.parentElement!;
}

// PODIUM-COMPETITION-R1-EXEC — resultado padrão de uma linha do leaderboard
// (assinatura real, lib/podium/leaderboardRepository.ts): sellerId/
// sellerLabel/saleCount/completedVisitCount/rank. Nunca revenueCents (não
// existe no contrato — §11/§24 do EXEC).
function leaderboardRow(over: Partial<Record<string, unknown>> = {}) {
  return { sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, completedVisitCount: 0, rank: 1, ...over };
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
  // HOME-PODIUM-R1-EXEC — default 'sale_local', mesmo raciocínio do default
  // de Tasks/Visits/Deals acima: preserva o baseline local de todos os
  // testes escritos antes deste lote. Toda describe com Leads remoto (e
  // isLocalCommercialDataAllowed=false) sobrescreve para um mode não-local
  // próprio (nunca 'sale_local' junto de Leads remoto/Sellers remoto).
  m.useRemoteSalesScreenState.mockReset().mockReturnValue(saleScreenState('sale_local'));
  m.useCurrentCompanySellerLabels.mockReset().mockReturnValue(currentCompanySellerLabelsResult());
  // HOME-FILTERS-R1-EXEC — default 'ready' com um timezone real qualquer:
  // preserva o baseline "período resolvido" para todos os testes escritos
  // antes deste lote (nenhum deles testa loading/erro/indisponível de
  // timezone especificamente — cobertura própria na suíte dedicada abaixo).
  m.useCurrentCompanyTimezone.mockReset().mockReturnValue({ status: 'ready', timezone: 'America/Sao_Paulo' });
  // PODIUM-COMPETITION-R1-EXEC — default 'local', mesmo raciocínio do
  // default de Sales/Tasks/Visits/Deals acima: preserva o baseline local de
  // todos os testes escritos antes deste lote. Toda describe com Leads
  // remoto sobrescreve para um status não-local próprio.
  m.useCompanySellerLeaderboard.mockReset().mockReturnValue({ status: 'local' });
  // PODIUM-COMPETITION-R2B-B1-EXEC — default 'local', mesmo raciocínio do
  // default de useCompanySellerLeaderboard acima.
  m.useSellerCompetitionEvents.mockReset().mockReturnValue({ status: 'local' });
  m.useMarkCompetitionEventsSeen.mockReset().mockReturnValue({ markSeen: vi.fn().mockResolvedValue(1), isPending: false });
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
describe('Home — Ranking completo em modo remoto: leaderboard indisponível (E7-B1 / PODIUM-COMPETITION-R1-EXEC)', () => {
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
    // PODIUM-COMPETITION-R1-EXEC — mesma garantia estrutural para o
    // leaderboard: esta suíte não testa o Ranking real especificamente
    // (cobertura própria abaixo), então usa 'unavailable'.
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'unavailable' });
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

  it('ranking/CompTicker/Minha Disputa fixture somem; título "Pódio de campeões" permanece, agora movido para dados reais (PODIUM-COMPETITION-R1-EXEC)', () => {
    renderHome(manager());
    expect(screen.queryByText('PÓDIO DE CAMPEÕES')).toBeNull();
    expect(screen.queryByText('Ranking completo')).toBeNull();
    expect(screen.queryByText('Minha disputa')).toBeNull();
    expect(screen.getByText('Pódio de campeões')).toBeInTheDocument();
    expect(screen.getByText('Métricas comerciais indisponíveis nesta sessão.')).toBeInTheDocument();
  });

  it('widgets de Leads remotos (fora do escopo de Sellers) continuam funcionando normalmente', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    renderHome(manager());
    // HOME-ATTENTION-R1-EXEC §5 — "leads atrasados" foi removido de
    // Attention (auditoria: Lead.urgency é estado de evento, não atraso
    // objetivo); o funil de conversão (Leads total) continua real.
    expect(screen.queryByText('leads atrasados')).toBeNull();
    expect(screen.getAllByText('Leads').length).toBeGreaterThan(0);
  });
});

// ── Ranking completo real (PODIUM-COMPETITION-R1-EXEC) ──────────────────
// "Pódio de campeões"/"Ranking completo"/seletor A-D reativados com o
// leaderboard company-wide real (list_company_seller_leaderboard, agregado
// 100% server-side) — nunca mais Sales/Visits brutas, nunca mais fixture.
// useCompanySellerLeaderboard é mockado diretamente (cobertura própria do
// hook — loading/error/empty/ready/cascade de período — fica em
// tests/hooks/useCompanySellerLeaderboard.test.tsx); aqui só se prova o
// que Home FAZ com cada estado do hook.
describe('Home — Ranking completo real (PODIUM-COMPETITION-R1-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  it('Manager: título real, nome/vendas reais no Ranking completo, zero fixture', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, completedVisitCount: 2, rank: 1 })],
    });
    renderHome(manager());
    expect(screen.getByText('Ranking completo')).toBeInTheDocument();
    // 1 seller só: cai no Top 3 do Pódio E na RankingList — aparece 2x.
    expect(screen.getAllByText('Lucas Martins').length).toBe(2);
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });

  it('todos os Sellers ativos aparecem no Ranking completo, inclusive além do Top 3 do pódio', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 4, rank: 2 }),
        leaderboardRow({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 3, rank: 3 }),
        leaderboardRow({ sellerId: 's4', sellerLabel: 'Bianca Alves', saleCount: 0, completedVisitCount: 0, rank: 4 }),
      ],
    });
    renderHome(manager());
    // Um seller do Top 3 aparece 2x no DOM (dentro do Pódio + na
    // RankingList); um seller FORA do Top 3 aparece só 1x (só na
    // RankingList) — prova mecânica de que o roster completo (não só
    // Top3) está sendo listado.
    expect(screen.getAllByText('Lucas Martins').length).toBe(2);
    expect(screen.getAllByText('Bianca Alves').length).toBe(1);
    expect(screen.getByText('4 vendedores')).toBeInTheDocument();
  });

  it('Seller com ZERO vendas aparece no Ranking (quando já existe alguma venda na empresa)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Bianca Alves', saleCount: 0, completedVisitCount: 0, rank: 2 }),
      ],
    });
    renderHome(manager());
    // 2 sellers só: ambos caem no Top 3 do Pódio E na RankingList.
    expect(screen.getAllByText('Bianca Alves').length).toBe(2);
  });

  it('seletor A/B/C/D altera SOMENTE a variante — remoto nunca chama setTweak (preferência remota é própria, localStorage)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, rank: 1 })],
    });
    const setTweak = vi.fn();
    render(<Home t={{ podium: 'B' }} setTweak={setTweak} go={vi.fn()} active={false} currentUser={manager() as any} />);
    // Clica no próprio chip 'B' (já ativo) — evita o caminho FitBox/
    // ResizeObserver das variantes A/C/D (ausente no jsdom, fora de escopo
    // desta suíte), mas já prova que o clique nunca chama setTweak no
    // modo remoto.
    fireEvent.click(screen.getByTitle('Líder'));
    expect(setTweak).not.toHaveBeenCalled();
  });

  it('VOCÊ marca a própria linha do Seller logado', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, rank: 2 }),
      ],
    });
    // RankingRow resolve "VOCÊ" via AuthService.getCurrentUser() (não via
    // a prop currentUser da Home) — mesmo acoplamento já existente no
    // componente legado original.
    m.authGetCurrentUser.mockReturnValue(seller('s1'));
    renderHome(seller('s1'));
    expect(screen.getByText('VOCÊ')).toBeInTheDocument();
    const rankingList = within(getRankingListContainer());
    expect(rankingList.getByText('Lucas Martins').parentElement?.textContent).toContain('VOCÊ');
  });

  it('SEU ALVO marca a linha imediatamente acima do Seller logado', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, rank: 2 }),
        leaderboardRow({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 1, rank: 3 }),
      ],
    });
    renderHome(seller('s1'));
    expect(screen.getByText('SEU ALVO')).toBeInTheDocument();
    const rankingList = within(getRankingListContainer());
    expect(rankingList.getByText('Ana Souza').parentElement?.textContent).toContain('SEU ALVO');
  });

  it('1º colocado nunca tem SEU ALVO', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 3, rank: 2 }),
      ],
    });
    renderHome(seller('s1'));
    expect(screen.queryByText('SEU ALVO')).toBeNull();
  });

  it('Manager: nenhuma linha marcada como VOCÊ/SEU ALVO (sem posição pessoal — §11/§20 do EXEC)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 3, rank: 2 }),
      ],
    });
    renderHome(manager());
    expect(screen.queryByText('VOCÊ')).toBeNull();
    expect(screen.queryByText('SEU ALVO')).toBeNull();
  });

  it('nenhuma conversão (%) aparece no Ranking/Pódio real (§21 do EXEC)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, completedVisitCount: 2, rank: 1 })],
    });
    renderHome(manager());
    expect(screen.queryByText('Conv.')).toBeNull();
    expect(screen.queryByText('Conversão')).toBeNull();
  });

  it('Manager: CompTicker e Minha Disputa nunca aparecem (personagem pessoal é só do Seller — PODIUM-COMPETITION-R2A-EXEC §21)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 1, rank: 2 }),
      ],
    });
    renderHome(manager());
    expect(screen.queryByText('Minha disputa')).toBeNull();
    expect(screen.queryByText(/Faltam .* vendas para você entrar no/)).toBeNull();
    expect(screen.queryByText('Você está na liderança.')).toBeNull();
  });

  it('loading: notice dedicado, nenhuma linha renderizada', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'loading' });
    renderHome(manager());
    expect(screen.getByText('Carregando pódio…')).toBeInTheDocument();
    expect(screen.queryByText('Lucas Martins')).toBeNull();
  });

  it('erro: mensagem sanitizada com retry, sem fallback fixture', () => {
    const retry = vi.fn();
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'error', retry });
    renderHome(manager());
    expect(screen.getByText('Não foi possível carregar o pódio.')).toBeInTheDocument();
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(retry).toHaveBeenCalled();
  });

  it('empty (empresa sem nenhuma venda no período): copy honesta, X vendedores na disputa, zero nomes falsos', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'empty', sellerCount: 5 });
    renderHome(manager());
    expect(screen.getByText('Aguardando as primeiras vendas')).toBeInTheDocument();
    expect(screen.getByText('Assim que a equipe registrar a primeira venda, a disputa começa.')).toBeInTheDocument();
    expect(screen.getByText('5 vendedores na disputa')).toBeInTheDocument();
    expect(screen.queryByText('Lucas Martins')).toBeNull();
  });

  it('Seller: mesmo leaderboard company-wide do Manager (nunca só a própria linha)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 1, rank: 2 }),
      ],
    });
    renderHome(seller('s1'));
    // Ambos caem no Top 3 do Pódio E na RankingList (só 2 sellers no total).
    // Lucas (s1, líder) também aparece no header do card Minha Disputa
    // (PODIUM-COMPETITION-R2A-EXEC) — 3ª ocorrência do próprio nome; Ana
    // (chaser) só aparece pelo primeiro nome em "Minha Disputa", então
    // continua em 2 ocorrências do nome completo.
    expect(screen.getAllByText('Lucas Martins').length).toBe(3);
    expect(screen.getAllByText('Ana Souza').length).toBe(2);
  });
});

// ── Minha Disputa + CompTicker reais (PODIUM-COMPETITION-R2A-EXEC) ──────
// Camada pessoal derivada do MESMO leaderboard (nenhuma segunda fonte).
// A lógica de negócio (rival/gap/empate/liderança/Top3/mensagens
// permitidas) tem cobertura própria e exaustiva em
// tests/podium/competition.test.ts — aqui só se prova o que Home FAZ com
// o resultado: gating por papel, wiring de period/variant, ausência de
// fixture.
// "Minha disputa" está sempre dentro de um <div> (não <span>, ao contrário
// do título "Ranking completo") — .closest('div') já retorna o próprio nó,
// então 3 níveis de parentElement chegam ao card inteiro (header com nome/
// posição + grid de stats/RaceMsg). Necessário porque o Pódio variante B
// também mostra badges "2º"/"3º" e o CompTicker duplica cada mensagem 2x
// (loop de scroll) — sem escopo, getByText colide com esses outros nós.
function getMinhaDisputaContainer() {
  return screen.getByText('Minha disputa').closest('div')!.parentElement!.parentElement!.parentElement!;
}

describe('Home — Minha Disputa + CompTicker reais (PODIUM-COMPETITION-R2A-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
  });

  const THREE_ROWS = [
    leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 5, completedVisitCount: 3, rank: 1 }),
    leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, completedVisitCount: 2, rank: 2 }),
    leaderboardRow({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 1, completedVisitCount: 1, rank: 3 }),
  ];

  it('Seller (perseguindo): Minha Disputa real aparece com posição, vendas, visitas e rival direto', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'ready', rows: THREE_ROWS });
    renderHome(seller('s1'));
    const card = within(getMinhaDisputaContainer());
    expect(card.getByText('Minha disputa')).toBeInTheDocument();
    expect(card.getByText('Minha posição').nextElementSibling?.textContent).toBe('2º');
    expect(card.getByText('Faltam 2 vendas para alcançar Ana.')).toBeInTheDocument();
    // Fonte real: saleCount/completedVisitCount, nada de leads/agendadas/conversão fixture.
    expect(card.getByText('Minhas vendas')).toBeInTheDocument();
    expect(card.getByText('Visitas realizadas')).toBeInTheDocument();
    expect(card.queryByText('Meus leads')).toBeNull();
    expect(card.queryByText('Agendadas')).toBeNull();
    expect(card.queryByText('Conversão')).toBeNull();
    expect(card.queryByText(/Meta da semana/)).toBeNull();
  });

  it('Seller em 1º lugar: estado de liderança, sem SEU ALVO, com perseguidor', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 5, rank: 1 }),
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 3, rank: 2 }),
      ],
    });
    renderHome(seller('s1'));
    const card = within(getMinhaDisputaContainer());
    expect(card.getByText('Você está na liderança.')).toBeInTheDocument();
    expect(card.getByText('Você lidera por 2 vendas.')).toBeInTheDocument();
    expect(card.getByText('Ana está logo atrás com 3 vendas.')).toBeInTheDocument();
    expect(screen.queryByText('SEU ALVO')).toBeNull();
  });

  it('Seller fora do Top 3: linha de gap para o Top 3 aparece na Minha Disputa', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [
        leaderboardRow({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 8, rank: 1 }),
        leaderboardRow({ sellerId: 's3', sellerLabel: 'Bianca Alves', saleCount: 6, rank: 2 }),
        leaderboardRow({ sellerId: 's4', sellerLabel: 'João Ferreira', saleCount: 4, rank: 3 }),
        leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 2, rank: 4 }),
      ],
    });
    renderHome(seller('s1'));
    const card = within(getMinhaDisputaContainer());
    expect(card.getByText('Faltam 2 vendas para entrar no Top 3.')).toBeInTheDocument();
  });

  it('Manager: nunca vê Minha Disputa nem CompTicker, mesmo com leaderboard pronto', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'ready', rows: THREE_ROWS });
    renderHome(manager());
    expect(screen.queryByText('Minha disputa')).toBeNull();
    expect(screen.queryByText('Você está na liderança.')).toBeNull();
  });

  it('Super Admin sem company context: leaderboard unavailable, nenhuma superfície pessoal', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'unavailable' });
    render(<Home t={{ podium: 'B' }} setTweak={vi.fn()} go={vi.fn()} active={false} currentUser={superAdmin() as any} />);
    expect(screen.queryByText('Minha disputa')).toBeNull();
    expect(screen.queryByText('Você está na liderança.')).toBeNull();
  });

  it('loading: sem Minha Disputa com zeros, sem ticker fake', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'loading' });
    renderHome(seller('s1'));
    expect(screen.queryByText('Minha disputa')).toBeNull();
  });

  it('erro: sem Minha Disputa/ticker stale', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'error', retry: vi.fn() });
    renderHome(seller('s1'));
    expect(screen.queryByText('Minha disputa')).toBeNull();
  });

  it('empty (zero Sales): Minha Disputa não renderiza, nenhuma disputa inventada', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'empty', sellerCount: 3 });
    renderHome(seller('s1'));
    expect(screen.queryByText('Minha disputa')).toBeNull();
  });

  it('leaderboard sem o Seller logado (fail-safe): Minha Disputa não renderiza, não lança', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's9', sellerLabel: 'Outra Pessoa', saleCount: 2, rank: 1 })],
    });
    expect(() => renderHome(seller('s1'))).not.toThrow();
    expect(screen.queryByText('Minha disputa')).toBeNull();
  });

  it('trocar A/B/C/D não altera rival/posição/mensagens da Minha Disputa (independência §18)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'ready', rows: THREE_ROWS });
    renderHome(seller('s1'));
    const posBefore = within(getMinhaDisputaContainer()).getByText('Minha posição').nextElementSibling?.textContent;
    fireEvent.click(screen.getByTitle('Líder'));
    const posAfter = within(getMinhaDisputaContainer()).getByText('Minha posição').nextElementSibling?.textContent;
    expect(posAfter).toBe(posBefore);
  });

  it('CompTicker real: só mensagens permitidas (§13), nenhuma proibida (§14)', () => {
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'ready', rows: THREE_ROWS });
    renderHome(seller('s1'));
    // s1 (Lucas, 2º) tem rival direto com gap (Ana) e não está fora do
    // Top 3 (rank 2) — mensagens esperadas: fato do líder (nome curto,
    // igual ao resto da UI) + alvo direto. Ticker duplica cada mensagem 2x
    // (loop de scroll) — getAllByText, nunca getByText, para essas.
    expect(screen.getAllByText('Ana lidera com 5 vendas.').length).toBe(2);
    expect(screen.getAllByText('Seu alvo é Ana, com 5 vendas.').length).toBe(2);
    expect(screen.queryByText(/subiu|ultrapass|caiu|Meta da semana|AO VIVO/i)).toBeNull();
  });

  it('CompTicker real: mostra a mensagem de liderança quando estou em 1º, mesmo sozinho na empresa', () => {
    // Único seller: leading, sem chaser -> ainda assim gera a mensagem
    // "Você está na liderança." (nunca ticker vazio quando há disputa real).
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 2, rank: 1 })],
    });
    renderHome(seller('s1'));
    // Aparece 2x no ticker (loop de scroll) + 1x no card Minha Disputa.
    expect(screen.getAllByText('Você está na liderança.').length).toBe(3);
  });
});

// ── Comemoração persistente pendente no load da Home (PODIUM-COMPETITION-R2B-B1-EXEC) ──
// Cobre o caso "Manager registrou a venda enquanto o Seller estava
// offline" (§25/§32 do EXEC). useSellerCompetitionEvents/
// useMarkCompetitionEventsSeen são mockados diretamente (cobertura própria
// dos hooks em tests/hooks/) — aqui só se prova o que Home FAZ com o
// resultado: mostra a comemoração real, marca visto ao fechar, nunca
// repete.
describe('Home — comemoração pendente no load (PODIUM-COMPETITION-R2B-B1-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'unavailable' });
  });

  function unseenEvent(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'evt-1', eventType: 'rank_up', oldRank: 4, newRank: 1, saleCount: 5,
      relatedSellerId: null, relatedSellerLabel: null, competitionStarted: true,
      periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z',
      createdAt: '2026-08-10T12:00:00Z', ...over,
    };
  }

  it('Seller com evento unseen: comemoração real aparece no load', () => {
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'ready', events: [unseenEvent()] });
    renderHome(seller('s1'));
    expect(screen.getByText('Primeira venda do mês!')).toBeInTheDocument();
    expect(screen.getByText('Você abriu a disputa e assumiu a liderança.')).toBeInTheDocument();
  });

  it('Seller sem evento unseen (ready, array vazio): nenhuma comemoração', () => {
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'ready', events: [] });
    renderHome(seller('s1'));
    expect(screen.queryByText('Primeira venda do mês!')).toBeNull();
  });

  it('loading/error/unavailable: nunca mostra comemoração fake', () => {
    const states: any[] = [{ status: 'loading' }, { status: 'error', retry: vi.fn() }, { status: 'unavailable' }];
    for (const state of states) {
      m.useSellerCompetitionEvents.mockReturnValue(state);
      const { unmount } = renderHome(seller('s1'));
      expect(screen.queryByText('Primeira venda do mês!')).toBeNull();
      unmount();
    }
  });

  it('Manager: nunca mostra comemoração pessoal (hook já nega — Home só reflete o estado)', () => {
    m.useSellerCompetitionEvents.mockReturnValue({ status: 'unavailable' });
    renderHome(manager());
    expect(screen.queryByText('Primeira venda do mês!')).toBeNull();
  });

  it('fechar a comemoração: marca vistos TODOS os unseen carregados, some da tela, nunca repete', () => {
    const markSeen = vi.fn().mockResolvedValue(2);
    m.useMarkCompetitionEventsSeen.mockReturnValue({ markSeen, isPending: false });
    m.useSellerCompetitionEvents.mockReturnValue({
      status: 'ready',
      events: [unseenEvent({ id: 'evt-1' }), unseenEvent({ id: 'evt-2', competitionStarted: false, oldRank: 3, newRank: 2 })],
    });
    renderHome(seller('s1'));
    expect(screen.getByText('Primeira venda do mês!')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continuar'));

    expect(markSeen).toHaveBeenCalledWith(['evt-1', 'evt-2']);
    expect(screen.queryByText('Primeira venda do mês!')).toBeNull();
  });

  it('múltiplos unseen: escolhe 1 evento principal (nunca dois modais)', () => {
    m.useSellerCompetitionEvents.mockReturnValue({
      status: 'ready',
      events: [
        unseenEvent({ id: 'evt-1', competitionStarted: false, oldRank: 6, newRank: 4 }),
        unseenEvent({ id: 'evt-2', competitionStarted: true, oldRank: 2, newRank: 1 }),
      ],
    });
    renderHome(seller('s1'));
    // competition_started tem prioridade — só essa mensagem aparece.
    expect(screen.getByText('Primeira venda do mês!')).toBeInTheDocument();
    expect(screen.queryByText(/Você ganhou \d+ posiç/)).toBeNull();
  });
});

// ── HOME-FILTERS-R1-EXEC / PODIUM-COMPETITION-R1-EXEC — período real ────
// O filtro de período resolve boundaries reais (companyPeriod.ts, cobertura
// própria em tests/date/companyPeriod.test.ts) e os PASSA para
// useCompanySellerLeaderboard (mockado aqui) — a aritmética de datas em si
// não é reexercitada nesta suíte, só a fiação: trocar o botão de período
// muda o range enviado ao hook.
describe('Home — Pódio: filtro de período real (HOME-FILTERS-R1-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useCurrentCompanyTimezone.mockReturnValue({ status: 'ready', timezone: 'America/Sao_Paulo' });
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, rank: 1 })],
    });
  });

  function lastPeriodArg(): any {
    const calls = m.useCompanySellerLeaderboard.mock.calls;
    return calls[calls.length - 1][0].period;
  }

  it('default é "30 dias" — botão ativo visualmente, period.kind ready', () => {
    renderHome(manager());
    // "30 dias" aparece 2x quando o período está ativo: o botão do filtro e
    // o subtítulo do Pódio (que ecoa o período em uso) — só o botão importa aqui.
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveStyle({ color: '#2a2104' });
    expect(lastPeriodArg().kind).toBe('ready');
  });

  it('Hoje / 7 dias / 15 dias mudam de verdade o range enviado ao hook', () => {
    renderHome(manager());
    const initialRange = lastPeriodArg();
    fireEvent.click(screen.getByText('7 dias'));
    const after7 = lastPeriodArg();
    expect(after7.kind).toBe('ready');
    expect(after7.startMillis).not.toBe(initialRange.startMillis);
    fireEvent.click(screen.getByText('Hoje'));
    const afterHoje = lastPeriodArg();
    expect(afterHoje.startMillis).not.toBe(after7.startMillis);
  });

  it('loading: timezone da empresa ainda não resolvido — nunca mostra ranking sem filtro', () => {
    m.useCurrentCompanyTimezone.mockReturnValue({ status: 'loading' });
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'loading' });
    renderHome(manager());
    expect(screen.getByText('Carregando pódio…')).toBeInTheDocument();
    expect(screen.queryByText('Lucas Martins')).toBeNull();
  });

  it('Personalizado: range válido aplicado chama o hook com period.kind ready e os boundaries certos', () => {
    renderHome(manager());
    fireEvent.click(screen.getByText('Personalizado'));
    const today = new Date();
    const toYMD = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(today.getTime() - 5 * 86400000);
    fireEvent.change(screen.getByText('Data inicial').querySelector('input')!, { target: { value: toYMD(start) } });
    fireEvent.change(screen.getByText('Data final').querySelector('input')!, { target: { value: toYMD(today) } });
    fireEvent.click(screen.getByText('Aplicar'));
    expect(lastPeriodArg().kind).toBe('ready');
  });

  it('Personalizado: range inválido (start depois de end) mostra erro e não muda o range enviado ao hook', () => {
    renderHome(manager());
    const beforeRange = lastPeriodArg();
    fireEvent.click(screen.getByText('Personalizado'));
    fireEvent.change(screen.getByText('Data inicial').querySelector('input')!, { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByText('Data final').querySelector('input')!, { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByText('Aplicar'));
    expect(screen.getByText('A data inicial precisa ser antes da data final.')).toBeInTheDocument();
    expect(lastPeriodArg()).toEqual(beforeRange);
  });

  it('Personalizado: campos vazios mostram erro simples, sem em dash', () => {
    renderHome(manager());
    fireEvent.click(screen.getByText('Personalizado'));
    fireEvent.click(screen.getByText('Aplicar'));
    expect(screen.getByText('Escolha uma data inicial e uma data final.')).toBeInTheDocument();
  });
});

// ── HOME-FILTERS-R1-EXEC — período não afeta os demais blocos ───────────
describe('Home — trocar período do Pódio NÃO afeta outros blocos (HOME-FILTERS-R1-EXEC)', () => {
  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [{ id: 'd1', status: 'open', assignedSellerId: 's1' }],
    }));
    m.useCurrentCompanySellerLabels.mockReturnValue(
      currentCompanySellerLabelsResult({ sellersById: { s1: { id: 's1', name: 'Lucas Martins' } }, hasData: true, isEmpty: false }),
    );
    m.useCurrentCompanyTimezone.mockReturnValue({ status: 'ready', timezone: 'America/Sao_Paulo' });
    m.useCompanySellerLeaderboard.mockReturnValue({
      status: 'ready',
      rows: [leaderboardRow({ sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 1, rank: 1 })],
    });
  });

  it('Funil comercial não muda ao trocar período do Pódio', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    renderHome(manager());
    const leadsBefore = screen.getByText('Leads').closest('.lift')?.textContent;
    fireEvent.click(screen.getByText('Hoje'));
    const leadsAfter = screen.getByText('Leads').closest('.lift')?.textContent;
    expect(leadsAfter).toBe(leadsBefore);
    fireEvent.click(screen.getByText('7 dias'));
    expect(screen.getByText('Leads').closest('.lift')?.textContent).toBe(leadsBefore);
  });

  it('Atenção imediata não muda ao trocar período do Pódio (pendência atrasada continua vencida)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true, tasks: [{ id: 't1', state: TASK_STATE.LATE }],
    }));
    renderHome(manager());
    expect(screen.getByText('pendências atrasadas').closest('button')?.textContent).toContain('1');
    fireEvent.click(screen.getByText('Hoje'));
    expect(screen.getByText('pendências atrasadas').closest('button')?.textContent).toContain('1');
    fireEvent.click(screen.getByText('30 dias'));
    expect(screen.getByText('pendências atrasadas').closest('button')?.textContent).toContain('1');
  });

  it('Ações rápidas não muda ao trocar período do Pódio (sem dado, navegação intacta)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    renderHome(manager());
    expect(screen.getByText('Ações rápidas')).toBeInTheDocument();
    fireEvent.click(screen.getByText('7 dias'));
    expect(screen.getByText('Ações rápidas')).toBeInTheDocument();
    expect(screen.getByText('Ver atrasados')).toBeInTheDocument();
  });
});

// ── HOME-FILTERS-R1-EXEC — segmento Todos/Novos/Seminovos ───────────────
describe('Home — segmento Todos/Novos/Seminovos: ausente no remoto, preservado no local (HOME-FILTERS-R1-EXEC)', () => {
  it('remote mode: segmento NÃO é renderizado (nem fantasma, nem disabled visível)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useCompanySellerLeaderboard.mockReturnValue({ status: 'unavailable' });
    renderHome(manager());
    expect(screen.queryByText('Novos')).toBeNull();
    expect(screen.queryByText('Seminovos')).toBeNull();
    // 'Todos' só existiria dentro do controle de segmento removido — ausente também.
    expect(screen.queryByText('Todos')).toBeNull();
  });

  it('local mode: segmento continua exatamente como antes (Todos/Novos/Seminovos clicáveis)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    renderHome(manager());
    // getByRole('button', ...): 'Novos'/'Seminovos' também aparecem como
    // Seller.team em cards do Ranking local (DEFAULT_SELLERS) — o controle
    // de segmento em si é o botão na ControlBar, não qualquer texto solto.
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seminovos' })).toBeInTheDocument();
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
    // HOME-ATTENTION-R1-EXEC §5 — "leads atrasados" (Lead.urgency==='red')
    // foi auditado e REMOVIDO de Attention: é estado de evento
    // (calculateLeadHealth/default 'red' na criação do Lead), não "sem
    // contato há N dias" — sem contrato de atraso objetivo. O total real de
    // Leads continua visível no funil de conversão (ConversionFunnel).
    expect(screen.queryByText('leads atrasados')).toBeNull();
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

  // HOME-ATTENTION-R1-EXEC §2/§8 — count=0 não é mais "sucesso visível":
  // com lateCount=0 (e nenhuma outra métrica em Attention na V1), a seção
  // inteira "Atenção imediata" desaparece — nunca um card vermelho "0".
  it('lateCount=0: nenhum card falso, seção "Atenção imediata" inteira desaparece', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    renderHome(manager());
    expect(screen.queryByText('pendências atrasadas')).toBeNull();
    expect(screen.queryByText('Atenção imediata')).toBeNull();
  });

  it('independência A: Leads ready + Tasks loading — Leads normal, Tasks em loading', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    renderHome(manager());
    // "leads atrasados" foi removido de Attention (§5) — só resta o notice
    // de Tasks em loading.
    expect(screen.queryByText('leads atrasados')).toBeNull();
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
    // HOME-ATTENTION-R1-EXEC §5 — o erro de Leads não aparece mais em
    // Attention (o card "leads atrasados" foi removido); a superfície real
    // de erro de Leads passou a ser só o funil de conversão.
    expect(screen.getByText('Não foi possível carregar o funil.')).toBeInTheDocument();
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
    // "leads atrasados" foi removido de Attention (§5) — só resta o erro
    // sanitizado de Tasks.
    expect(screen.queryByText('leads atrasados')).toBeNull();
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

// ── G2. "Atenção imediata" V1 — REAL ATTENTION ONLY (HOME-ATTENTION-R1-EXEC) ─
// Consolida o contrato do lote: count=0 → card não existe; todos count=0 →
// seção não existe; leads atrasados/visitas não confirmadas/negociações em
// andamento NUNCA entram em Attention no remote mode (auditados e
// removidos — §5/§6/§4); só "pendências atrasadas" (Tasks LATE) sobrevive.
describe('Home — Atenção imediata V1: real attention only, zero noise (HOME-ATTENTION-R1-EXEC)', () => {
  function remoteTaskAttn(over: Partial<Record<string, unknown>> = {}) {
    return { id: 't1', state: TASK_STATE.LATE, ...over };
  }
  function remoteDealAttn(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'd1', status: 'open', assignedSellerId: 's1', ...over };
  }
  function remoteVisitAttn(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'v1', status: 'scheduled', ...over };
  }

  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));
  });

  it('todos os counts em 0 (sem pendências atrasadas, sem outras métricas): "Atenção imediata" não existe', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    renderHome(manager());
    expect(screen.queryByText('Atenção imediata')).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('1 métrica real (3 pendências atrasadas): mostra somente esse card — nenhum outro card, mesmo com Leads/Visits/Deals com dado real', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [remoteTaskAttn(), remoteTaskAttn({ id: 't2' }), remoteTaskAttn({ id: 't3' })],
    }));
    // Visits e Deals com dado real e count>0 — não devem virar card algum
    // em Attention (§4/§6), apenas Tasks sobrevive na V1.
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [remoteVisitAttn()] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDealAttn()] }));
    renderHome(manager());
    expect(screen.getByText('Atenção imediata')).toBeInTheDocument();
    const card = screen.getByText('pendências atrasadas').closest('button');
    expect(card?.textContent).toContain('3');
    expect(card?.textContent).toContain('Resolva o quanto antes');
    expect(card?.textContent).toContain('Resolver agora');
    expect(screen.queryByText('leads atrasados')).toBeNull();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
  });

  it('negociações OPEN sozinhas (sem pendências atrasadas): "Atenção imediata" não existe', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDealAttn(), remoteDealAttn({ id: 'd2' }), remoteDealAttn({ id: 'd3' })],
    }));
    renderHome(manager());
    expect(screen.queryByText('Atenção imediata')).toBeNull();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
  });

  it('Manager: pendências overdue reais entram em Attention', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTaskAttn()] }));
    renderHome(manager());
    expect(screen.getByText('pendências atrasadas').closest('button')?.textContent).toContain('1');
  });

  it('Seller: pendências overdue reais (próprio escopo/RLS) entram em Attention', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTaskAttn(), remoteTaskAttn({ id: 't2' })] }));
    renderHome(seller('s1'));
    expect(screen.getByText('pendências atrasadas').closest('button')?.textContent).toContain('2');
  });

  it('zero fixture: nenhum SellerService/LeadService/VisitService/DealService local é chamado para montar Attention no remote mode', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTaskAttn()] }));
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    renderHome(manager());
    expect(screen.getByText('pendências atrasadas')).toBeInTheDocument();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
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
    // HOME-PODIUM-R1-EXEC — mesma garantia estrutural para Sales: Leads
    // remoto ⟹ Sales nunca 'sale_local'. Esta suíte não testa o pódio real.
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));
  });

  // HOME-ATTENTION-R1-EXEC §6 — "visitas não confirmadas" (Visit.status===
  // 'scheduled') foi auditado e REMOVIDO de "Atenção imediata": é qualquer
  // visita futura ainda sem confirmação, sem nenhuma dimensão de tempo/
  // prazo — não é um contrato objetivo de "precisa de ação agora". O funil
  // de conversão (ConversionFunnel, "Visitas" — total em aberto) é uma
  // superfície DIFERENTE, fora do escopo deste lote, e continua real.
  it('snapshot [scheduled, scheduled, confirmed, completed, canceled]: card de Attention NUNCA aparece, funil mostra 3 em aberto — completed/canceled nunca contam', () => {
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
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    const funnelStage = screen.getByText('Visitas').closest('.lift');
    expect(funnelStage?.textContent).toContain('3');
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller: mesmo com visita própria scheduled, card de Attention não aparece', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [remoteVisit({ id: 'v1', status: 'scheduled' })],
    }));
    renderHome(seller('s1'));
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('loading/error/configError de Visits: nenhum notice "Carregando visitas…"/erro aparece mais em Attention', () => {
    m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { isLoading: true }));
    renderHome(manager());
    expect(screen.queryByText('Carregando visitas…')).toBeNull();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
  });

  it.each(['visit_blocked', 'visit_remote_misconfigured', 'visit_remote_unavailable_identity', 'visit_remote_active'])(
    '%s: card de Attention ausente, VisitService.getAll nunca chamado',
    (mode) => {
      m.visitServiceGetAll.mockReturnValue([{ id: 'v1', status: 'pendente' }]);
      m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState(mode, mode === 'visit_remote_active' ? { hasData: true, visits: [remoteVisit({ status: 'scheduled' })] } : {}));
      renderHome(manager());
      expect(screen.queryByText('visitas não confirmadas')).toBeNull();
      expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    },
  );

  it('independência A: Leads ready + Visits blocked — card de Attention some por Tasks unavailable, nunca por Visits', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_blocked'));
    renderHome(manager());
    expect(screen.queryByText('leads atrasados')).toBeNull();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
    expect(screen.queryByText('Atenção imediata')).toBeNull();
  });

  it('independência B: Leads error + Visits ready — Visits continua fora de Attention, funil de Leads mostra o erro sanitizado', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch: vi.fn() } }),
    );
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true, visits: [remoteVisit({ status: 'scheduled' })],
    }));
    renderHome(manager());
    // HOME-ATTENTION-R1-EXEC §5 — o erro de Leads não aparece mais em
    // Attention (o card "leads atrasados" foi removido); a superfície real
    // de erro de Leads passou a ser só o funil de conversão.
    expect(screen.getByText('Não foi possível carregar o funil.')).toBeInTheDocument();
    expect(screen.queryByText('visitas não confirmadas')).toBeNull();
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
//
// HOME-ATTENTION-R1-EXEC §4 — Deal OPEN é comportamento normal, não é
// problema por si só: o card "negociações em andamento" foi REMOVIDO de
// "Atenção imediata" (UrgentAttention), qualquer que seja openCount/status
// de dealsSummary. useHomeDealsSummary continua existindo intacto — ainda
// alimenta a seção separada "Equipe precisa de atenção" (Manager-only,
// testada isoladamente na suíte L abaixo) — só o card em Attention some.
describe('Home — Deals summary remoto: "negociações em andamento" NUNCA aparece em Attention (HOME-ATTENTION-R1-EXEC §4)', () => {
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
    // HOME-PODIUM-R1-EXEC — mesma garantia estrutural para Sales: Leads
    // remoto ⟹ Sales nunca 'sale_local'. Esta suíte não testa o pódio real.
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));
  });

  it('Manager: 3 Deals OPEN — card "negociações em andamento" NUNCA aparece em Attention (Deal aberto não é problema)', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'd1', status: 'open', assignedSellerId: 's1' }),
        remoteDeal({ id: 'd2', status: 'open', assignedSellerId: 's2' }),
        remoteDeal({ id: 'd3', status: 'open', assignedSellerId: 's3' }),
      ],
    }));
    renderHome(manager());
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller: mesmo com Deal próprio OPEN, card não aparece em Attention', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDeal({ id: 'd1', status: 'open', assignedSellerId: 's1' })],
    }));
    renderHome(seller('s1'));
    expect(screen.queryByText('negociações em andamento')).toBeNull();
  });

  it('openCount=0: card continua ausente (mesmo padrão de count=0 em qualquer outro estado)', () => {
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: false, isEmpty: true, deals: [] }));
    renderHome(manager());
    expect(screen.queryByText('negociações em andamento')).toBeNull();
  });

  it('loading/error/configError de Deals: nenhum notice "Carregando negociações…"/erro aparece mais em Attention', () => {
    m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isLoading: true }));
    renderHome(seller('s1'));
    expect(screen.queryByText('Carregando negociações…')).toBeNull();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  it.each(['deal_blocked', 'deal_remote_misconfigured', 'deal_remote_unavailable_identity'])(
    '%s: card ausente, DealService.getAll nunca chamado',
    (mode) => {
      m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
      m.useRemoteDealsScreenState.mockReturnValue(dealScreenState(mode));
      renderHome(manager());
      expect(screen.queryByText('negociações em andamento')).toBeNull();
      expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    },
  );

  it('independência: Leads error + Deals ready OPEN — card de Deals continua ausente em Attention', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { isError: true, isEmpty: false, refetch: vi.fn() } }),
    );
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true, deals: [remoteDeal({ id: 'd1', status: 'open' })],
    }));
    renderHome(manager());
    // HOME-ATTENTION-R1-EXEC §5 — o erro de Leads não aparece mais em
    // Attention (o card "leads atrasados" foi removido); a superfície real
    // de erro de Leads passou a ser só o funil de conversão.
    expect(screen.getByText('Não foi possível carregar o funil.')).toBeInTheDocument();
    expect(screen.queryByText('negociações em andamento')).toBeNull();
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

// ── J2. "Funil comercial" V1 real (HOME-CONVERSION-FUNNEL-R1-EXEC) ─────
// 4 etapas (Leads/Visitas/Negociações/Vendas), cada uma com estado remoto
// independente. Sem percentual entre etapas (A1-PRECHECK §4/§7/§8) — só
// volumes reais. Título remoto renomeado para "Funil comercial" (nunca
// "Funil de conversão", que fica exclusivo do legado local — §1/§20).
describe('Home — Funil comercial V1 real (HOME-CONVERSION-FUNNEL-R1-EXEC)', () => {
  function remoteDealFunnel(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'd1', status: 'open', assignedSellerId: 's1', ...over };
  }
  function remoteSaleFunnel(over: Partial<Record<string, unknown>> = {}) {
    return { id: 's1', assignedSellerId: 's1', soldValueCents: 1000000, soldAt: new Date().toISOString(), ...over };
  }

  beforeEach(() => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }, { id: 'r2', urgency: 'green' }] } }),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
  });

  it('Manager: 4 etapas reais com os valores exatos dos mocks remotos — título "Funil comercial", nenhum "%"', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', {
      hasData: true,
      visits: [{ id: 'v1', status: 'scheduled' }, { id: 'v2', status: 'confirmed' }, { id: 'v3', status: 'completed' }],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [remoteDealFunnel({ id: 'd1' }), remoteDealFunnel({ id: 'd2' }), remoteDealFunnel({ id: 'd3', status: 'lost' })],
    }));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', {
      hasData: true,
      sales: [remoteSaleFunnel({ id: 's1' }), remoteSaleFunnel({ id: 's2' })],
    }));
    renderHome(manager());

    expect(screen.getByText('Funil comercial')).toBeInTheDocument();
    expect(screen.queryByText('Funil de conversão')).toBeNull();

    const leadsStage = screen.getByText('Leads').closest('.lift');
    expect(leadsStage?.textContent).toContain('2');
    expect(leadsStage?.textContent).toContain('clientes cadastrados');

    const visitasStage = screen.getByText('Visitas').closest('.lift');
    expect(visitasStage?.textContent).toContain('2'); // scheduled + confirmed
    expect(visitasStage?.textContent).toContain('em aberto');

    const negociacoesStage = screen.getByText('Negociações').closest('.lift');
    expect(negociacoesStage?.textContent).toContain('2'); // só os 2 'open'
    expect(negociacoesStage?.textContent).toContain('em aberto');

    const vendasStage = screen.getByText('Vendas').closest('.lift');
    expect(vendasStage?.textContent).toContain('2');
    expect(vendasStage?.textContent).toContain('registradas');

    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('Seller: 4 etapas dentro do próprio escopo RLS (mocks já pré-filtrados)', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [{ id: 'v1', status: 'scheduled' }] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDealFunnel({ id: 'd1', assignedSellerId: 's1' })] }));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { hasData: true, sales: [remoteSaleFunnel({ id: 's1', assignedSellerId: 's1' })] }));
    renderHome(seller('s1'));
    expect(screen.getByText('Negociações').closest('.lift')?.textContent).toContain('1');
    expect(screen.getByText('Vendas').closest('.lift')?.textContent).toContain('1');
  });

  it('0 real (Vendas): mostra "0", nunca omite a etapa nem indisponibiliza', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { hasData: false, isEmpty: true, sales: [] }));
    renderHome(manager());
    const vendasStage = screen.getByText('Vendas').closest('.lift');
    expect(vendasStage?.textContent).toContain('0');
    expect(vendasStage?.textContent).toContain('registradas');
  });

  it('loading: etapa em loading mostra placeholder, nunca "0" antes da resposta; outras etapas ready continuam', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { isLoading: true }));
    renderHome(manager());
    const vendasStage = screen.getByText('Vendas').closest('.lift');
    expect(vendasStage?.textContent).toContain('Carregando');
    expect(vendasStage?.textContent).not.toContain('0');
    // Leads (sempre ready neste branch) continua mostrando o valor real.
    expect(screen.getByText('Leads').closest('.lift')?.textContent).toContain('2');
  });

  it('erro parcial: Negociações em erro não derruba Visitas/Vendas prontas', () => {
    const retry = vi.fn();
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [{ id: 'v1', status: 'scheduled' }] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isError: true, refetch: retry }));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { hasData: true, sales: [remoteSaleFunnel()] }));
    renderHome(manager());
    const negociacoesStage = screen.getByText('Negociações').closest('.lift');
    expect(negociacoesStage?.textContent).toContain('Não foi possível carregar');
    expect(screen.getByText('Visitas').closest('.lift')?.textContent).toContain('1');
    expect(screen.getByText('Vendas').closest('.lift')?.textContent).toContain('1');
    const [retryBtn] = screen.getAllByText('Tentar novamente');
    fireEvent.click(retryBtn);
    expect(retry).toHaveBeenCalled();
  });

  it('Visitas/Negociações/Vendas unavailable: etapa some por completo (nunca notice, nunca zero) — só Leads aparece', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_unavailable_identity'));
    renderHome(manager());
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.queryByText('Visitas')).toBeNull();
    expect(screen.queryByText('Negociações')).toBeNull();
    expect(screen.queryByText('Vendas')).toBeNull();
  });

  it('zero fixture: LeadService/VisitService/DealService/SaleService nunca chamados para montar o funil remoto', () => {
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_active', { hasData: true, visits: [{ id: 'v1', status: 'scheduled' }] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDealFunnel()] }));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { hasData: true, sales: [remoteSaleFunnel()] }));
    renderHome(manager());
    expect(screen.getByText('Vendas')).toBeInTheDocument();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
  });
});

// ── J3. Quick Action "Ver atrasados" — ícone clock (HOME-CONVERSION-FUNNEL-R1-EXEC §17) ─
describe('Home — Quick Action "Ver atrasados" usa clock, não flame (HOME-CONVERSION-FUNNEL-R1-EXEC)', () => {
  it('continua existindo, navega para o destino existente ("clientes"), sem flame', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    const go = vi.fn();
    const props: any = { t: { podium: 'B' }, setTweak: vi.fn(), go, active: false, currentUser: manager() };
    render(<Home {...props} />);
    const btn = screen.getByText('Ver atrasados').closest('button') as HTMLElement;
    expect(btn).toBeInTheDocument();
    // Ícone clock é um <circle> + ponteiros (path); flame era um <path> só
    // (blob fechado) — a presença de <circle> dentro do botão confirma a
    // troca sem depender de detalhe de implementação do Icon.
    expect(btn.querySelector('circle')).not.toBeNull();
    fireEvent.click(btn);
    // PILOT-UI-TRUTH-FIXES-R1-EXEC §11: agora carrega {filter:'Atrasados'}
    // (cobertura dedicada em "Home — Ações rápidas 'Ver atrasados'" abaixo).
    expect(go).toHaveBeenCalledWith('clientes', { filter: 'Atrasados' });
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

  it('Manager local: "Equipe precisa de atenção" NUNCA aparece (Tasks/Deals ambos local, gate exige pelo menos um domínio remoto relevante)', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    renderHome(manager());
    expect(screen.queryByText('Equipe precisa de atenção')).toBeNull();
  });
});

// ── L. Manager Team Attention (COMMERCIAL-REMOTE-DEALS-B7-B2) ──────────
// Seção Manager-only "Equipe precisa de atenção": duas subseções
// INDEPENDENTES (Tasks/Deals nunca combinadas numa linha), agrupamento por
// Seller via lib/home/managerAttention.ts (testado isoladamente em
// tests/home/managerAttention.test.ts — aqui só a integração com Home:
// gate, wiring de sellersById, readiness por domínio, ausência para Seller).
describe('Home — Manager Team Attention (Equipe precisa de atenção)', () => {
  function remoteTask(over: Partial<Record<string, unknown>> = {}) {
    return { id: 't1', title: 'x', lead: 'x', leadId: null, assignedTo: 's1', when: 'Hoje', prio: 'alta', note: '', state: TASK_STATE.LATE, createdAt: '2026-08-01T10:00:00Z', dueAt: '2026-08-01T10:00:00Z', version: 1, ...over };
  }
  function remoteDeal(over: Partial<Record<string, unknown>> = {}) {
    return { id: 'd1', leadId: 'l1', clientName: 'Cliente', assignedSellerId: 's1', vehicle: 'x', valueCents: 100, discountPercent: 0, paymentMethod: 'financiamento_100', downPaymentCents: null, installments: null, note: '', status: 'open', lostBy: null, lostAt: null, createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z', version: 1, ...over };
  }
  const SELLERS_BY_ID = { s1: { id: 's1', name: 'Lucas Martins' }, s2: { id: 's2', name: 'Ana Souza' } };

  beforeEach(() => {
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useCurrentCompanySellerLabels.mockReturnValue(currentCompanySellerLabelsResult({ sellersById: SELLERS_BY_ID, hasData: true, isEmpty: false }));
  });

  it('Manager: seção presente quando ao menos um domínio remoto tem estado relevante (aqui, só Tasks ready)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask()] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    renderHome(manager());
    expect(screen.getByText('Equipe precisa de atenção')).toBeInTheDocument();
  });

  it('Seller: seção SEMPRE ausente, mesmo com os dois domínios ready', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask()] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDeal()] }));
    renderHome(seller('s1'));
    expect(screen.queryByText('Equipe precisa de atenção')).toBeNull();
    // HOME-ATTENTION-R1-EXEC §4 — "negociações em andamento" foi REMOVIDO
    // de Attention (Deal OPEN não é mais atenção real); a Attention de
    // Seller continua funcionando normalmente via Tasks (remoteTask()
    // default é LATE).
    expect(screen.queryByText('negociações em andamento')).toBeNull();
    expect(screen.getByText('pendências atrasadas')).toBeInTheDocument();
  });

  it('Task group: conta LATE por Seller, TODAY/COMPLETED nunca contam (filtro já aplicado por useHomeTasksSummary)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [
        remoteTask({ id: 't1', assignedTo: 's1', state: TASK_STATE.LATE }),
        remoteTask({ id: 't2', assignedTo: 's1', state: TASK_STATE.LATE }),
        remoteTask({ id: 't3', assignedTo: 's1', state: TASK_STATE.LATE }),
        remoteTask({ id: 't4', assignedTo: 's1', state: TASK_STATE.TODAY }),
        remoteTask({ id: 't5', assignedTo: 's2', state: TASK_STATE.LATE }),
      ],
    }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    renderHome(manager());
    const section = screen.getByText('Acompanhamentos atrasados').closest('div')?.parentElement as HTMLElement;
    expect(section.textContent).toContain('Lucas Martins');
    expect(section.textContent).toContain('3');
    expect(section.textContent).toContain('Ana Souza');
    expect(section.textContent).toContain('1');
  });

  it('Deal group: conta OPEN por Seller, lost/sold nunca contam (filtro já aplicado por useHomeDealsSummary)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', {
      hasData: true,
      deals: [
        remoteDeal({ id: 'd1', assignedSellerId: 's1', status: 'open' }),
        remoteDeal({ id: 'd2', assignedSellerId: 's1', status: 'open' }),
        remoteDeal({ id: 'd3', assignedSellerId: 's1', status: 'open' }),
        remoteDeal({ id: 'd4', assignedSellerId: 's1', status: 'open' }),
        remoteDeal({ id: 'd5', assignedSellerId: 's1', status: 'lost' }),
        remoteDeal({ id: 'd6', assignedSellerId: 's2', status: 'open' }),
        remoteDeal({ id: 'd7', assignedSellerId: 's2', status: 'open' }),
        remoteDeal({ id: 'd8', assignedSellerId: 's2', status: 'sold' }),
      ],
    }));
    renderHome(manager());
    const section = screen.getByText('Negociações em andamento').closest('div')?.parentElement as HTMLElement;
    expect(section.textContent).toContain('Lucas Martins');
    expect(section.textContent).toContain('4');
    expect(section.textContent).toContain('Ana Souza');
    expect(section.textContent).toContain('2');
  });

  it('Empty: Tasks ready sem atrasados + Deals ready sem abertas mostram as duas mensagens congeladas', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: false, isEmpty: true, tasks: [] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: false, isEmpty: true, deals: [] }));
    renderHome(manager());
    expect(screen.getByText('Nenhum acompanhamento atrasado.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma negociação em andamento.')).toBeInTheDocument();
  });

  it('Partial: Tasks ready + Deals loading — Tasks visível, Deals em loading, zero fake', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask({ assignedTo: 's1' })] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isLoading: true }));
    renderHome(manager());
    const taskSection = screen.getByText('Acompanhamentos atrasados').closest('div')?.parentElement as HTMLElement;
    expect(taskSection.textContent).toContain('Lucas Martins');
    // Aparece 2x (célula compartilhada de UrgentAttention + subseção
    // Manager) — ambas legítimas, mesmo dealsSummary.status==='loading'.
    expect(screen.getAllByText('Carregando negociações…').length).toBeGreaterThan(0);
  });

  it('Partial (inverso): Deals ready + Tasks loading — Deals visível, Tasks em loading, zero fake', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDeal({ assignedSellerId: 's1' })] }));
    renderHome(manager());
    const dealSection = screen.getByText('Negociações em andamento').closest('div')?.parentElement as HTMLElement;
    expect(dealSection.textContent).toContain('Lucas Martins');
    expect(screen.getByText('Carregando acompanhamentos…')).toBeInTheDocument();
  });

  it('Error independence: Tasks error + Deals ready — Deals permanece, Tasks mostra erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isError: true, refetch }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDeal({ assignedSellerId: 's1' })] }));
    renderHome(manager());
    const dealSection = screen.getByText('Negociações em andamento').closest('div')?.parentElement as HTMLElement;
    expect(dealSection.textContent).toContain('Lucas Martins');
    expect(screen.getByText('Não foi possível carregar os acompanhamentos.')).toBeInTheDocument();
  });

  it('Error independence (inverso): Deals error + Tasks ready — Tasks permanece, Deals mostra erro com retry', () => {
    const refetch = vi.fn();
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask({ assignedTo: 's1' })] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { isError: true, refetch }));
    renderHome(manager());
    const taskSection = screen.getByText('Acompanhamentos atrasados').closest('div')?.parentElement as HTMLElement;
    expect(taskSection.textContent).toContain('Lucas Martins');
    // Aparece 2x (célula compartilhada de UrgentAttention + subseção
    // Manager) — ambas legítimas, mesmo dealsSummary.status==='error'.
    expect(screen.getAllByText('Não foi possível carregar as negociações.').length).toBeGreaterThan(0);
  });

  it('Deals OFF: subseção Tasks continua, subseção Deals ausente, zero DealService', () => {
    m.dealServiceGetAll.mockReturnValue([{ id: 'd1', status: 'open' }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask({ assignedTo: 's1' })] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_blocked'));
    renderHome(manager());
    expect(screen.getByText('Acompanhamentos atrasados')).toBeInTheDocument();
    expect(screen.queryByText('Negociações em andamento')).toBeNull();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
  });

  it('Tasks unavailable: subseção Deals continua, subseção Tasks ausente, zero TaskService local', () => {
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDeal({ assignedSellerId: 's1' })] }));
    renderHome(manager());
    expect(screen.getByText('Negociações em andamento')).toBeInTheDocument();
    expect(screen.queryByText('Acompanhamentos atrasados')).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('nenhuma linguagem proibida na nova seção (score/performance/aprovação/relação Task-Deal)', () => {
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { hasData: true, tasks: [remoteTask()] }));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_active', { hasData: true, deals: [remoteDeal()] }));
    renderHome(manager());
    expect(screen.queryByText(/Negociações sem acompanhamento/)).toBeNull();
    expect(screen.queryByText(/Deal atrasada/)).toBeNull();
    expect(screen.queryByText(/Negociação parada/)).toBeNull();
    expect(screen.queryByText(/Aguardando aprovação/)).toBeNull();
    expect(screen.queryByText(/^Aprovar$/)).toBeNull();
    expect(screen.queryByText(/Score/)).toBeNull();
    expect(screen.queryByText(/Performance/)).toBeNull();
  });
});

// PILOT-UI-TRUTH-FIXES-R1-EXEC §11 — achado do PILOT-UI-TRUTH-AUDIT-A1: "Ver
// atrasados" navegava para Clientes sem aplicar nenhum filtro (go() não
// aceitava parâmetro nenhum). go() agora aceita um segundo argumento
// opcional (mesmo padrão de openFlow(id, payload) em App.tsx) — QuickActions
// passa {filter:'Atrasados'} só para esta ação; as demais continuam sem
// parâmetro algum.
function renderHomeWithGo(currentUser: any, go: (id: string, params?: any) => void) {
  return render(<Home t={{ podium: 'B' }} setTweak={vi.fn()} go={go} active={false} currentUser={currentUser} />);
}

describe('Home — Ações rápidas "Ver atrasados" (PILOT-UI-TRUTH-FIXES-R1-EXEC §11)', () => {
  beforeEach(() => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
  });

  it('"Ver atrasados" chama go com {filter: "Atrasados"}, não só o id da tela', () => {
    const go = vi.fn();
    renderHomeWithGo(manager(), go);
    fireEvent.click(screen.getByText('Ver atrasados'));
    expect(go).toHaveBeenCalledWith('clientes', { filter: 'Atrasados' });
  });

  it('demais Ações rápidas continuam sem parâmetro nenhum (nenhum filtro inventado)', () => {
    const go = vi.fn();
    renderHomeWithGo(manager(), go);
    fireEvent.click(screen.getByText('Novo cliente'));
    expect(go).toHaveBeenCalledWith('clientes', undefined);
  });
});

// PILOT-UI-TRUTH-FIXES-R1-EXEC §12 — achado do PILOT-UI-TRUTH-AUDIT-A1: o
// badge "AO VIVO"/"ao vivo" (Pódio/ControlBar) não tinha nenhum polling real
// por trás (staleTime de 5min, sem refetchInterval/websocket) — copy
// removida por completo, local e remoto, sem substituto.
describe('Home — badge "AO VIVO" removido (PILOT-UI-TRUTH-FIXES-R1-EXEC §12)', () => {
  it('nunca aparece no Pódio/Home no modo local', () => {
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    renderHome(manager());
    expect(screen.queryByText('AO VIVO')).toBeNull();
    expect(screen.queryByText('ao vivo')).toBeNull();
  });

  it('nunca aparece no Pódio/Home no modo remoto', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [] } }),
    );
    m.useRemoteVisitsScreenState.mockReturnValue(visitScreenState('visit_remote_unavailable_identity'));
    m.useRemoteDealsScreenState.mockReturnValue(dealScreenState('deal_remote_unavailable_identity'));
    m.useRemoteSalesScreenState.mockReturnValue(saleScreenState('sale_remote_active', { hasData: true, isEmpty: true, sales: [] }));
    renderHome(manager());
    expect(screen.queryByText('AO VIVO')).toBeNull();
    expect(screen.queryByText('ao vivo')).toBeNull();
  });
});
