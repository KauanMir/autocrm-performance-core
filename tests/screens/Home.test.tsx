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

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
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
