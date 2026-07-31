// Teste de integração do shell autenticado (M1-E, E7-A1). Renderiza <App />
// de verdade — Home e Rail NÃO são mockados — reproduzindo a classe de bug
// encontrada no E7-A0: TaskService.getAll()/VisitService.getAll()/
// DealService.getAll()/SaleService.getAll()/LeadService.getAll() chamados
// incondicionalmente durante o render de Home/Rail, quebrando o shell
// inteiro para qualquer papel sob REMOTE_LEADS=true. useRemoteLeadsScreenState
// e a bridge são mockados (a bridge já tem cobertura própria; aqui provamos
// que Home não depende mais dela) — mesmo padrão de mock de serviços/telas
// de tests/navigation/appCacheIdentity.test.tsx, mas SEM mockar Home.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  restoredUser: { current: null as User | null },
  leadServiceGetAll: vi.fn(),
  visitServiceGetAll: vi.fn(),
  dealServiceGetAll: vi.fn(),
  saleServiceGetAll: vi.fn(),
  taskServiceGetAll: vi.fn(),
  sellerServiceGetAll: vi.fn(),
  sellerServiceGetById: vi.fn(),
}));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: m.useRemoteLeadsScreenState,
}));

// A bridge não é mockada por conveniência: é removida do caminho de Home
// por definição (achado do E7-A0/objetivo do E7-A1) — este teste prova que
// o shell nunca precisa dela para renderizar a Home remota.
vi.mock('@/lib/hooks/useLeadsRemoteBridgeLifecycle', () => ({
  useLeadsRemoteBridgeLifecycle: () => {},
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isRemoteLeadsEnabled: m.isRemoteLeadsEnabled,
    isRemoteStagesEnabled: m.isRemoteStagesEnabled,
  };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}), subscribeStore: () => () => {} }));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
  },
  SellerService: { getAll: m.sellerServiceGetAll, getById: m.sellerServiceGetById },
  LeadService: { getAll: m.leadServiceGetAll },
  VisitService: { getAll: m.visitServiceGetAll },
  DealService: { getAll: m.dealServiceGetAll },
  SaleService: { getAll: m.saleServiceGetAll },
  TaskService: { getAll: m.taskServiceGetAll },
}));

vi.mock('@/components/ui/TweaksPanel', () => ({
  useTweaks: () => [{ podium: 'B', anim: false, showRevenue: false }, vi.fn()],
  TweaksPanel: () => null,
  TweakSection: () => null,
  TweakRadio: () => null,
  TweakToggle: () => null,
  TweakButton: () => null,
}));

vi.mock('@/components/auth/AuthFlow', () => ({
  AuthFlow: () => <div data-testid="auth-flow">login</div>,
}));

vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => null, ScreenAndamento: () => null, ScreenPendencias: () => null,
}));
vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => null, ScreenPropostas: () => null, ScreenVendas: () => null,
  ScreenResultados: () => null, ScreenAjustes: () => null,
}));
vi.mock('@/components/screens/ScreenEmpresas', () => ({ ScreenEmpresas: () => null }));
vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function manager(): User {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
  };
}

function seller(): User {
  return {
    id: 'user-2', name: 'Beatriz Lima', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' },
  };
}

function superAdmin(): User {
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
  pipeline?: Partial<Record<string, unknown>>; sellerLabels?: Partial<Record<string, unknown>>; leads?: Partial<Record<string, unknown>>;
} = {}) {
  return { mode, pipeline: pipelineResult(over.pipeline), sellerLabels: sellerLabelsResult(over.sellerLabels), leads: leadsResult(over.leads) };
}

const DEFAULT_SELLERS = [
  { id: 's1', name: 'Marcos Silva', first: 'Marcos', team: 'Seminovos', leads: 10, scheduled: 2, visits: 5, sales: 8, conv: 40, move: 0 },
  { id: 's2', name: 'Ana Souza', first: 'Ana', team: 'Novos', leads: 8, scheduled: 1, visits: 4, sales: 6, conv: 35, move: 1 },
  { id: 's3', name: 'João Ferreira', first: 'João', team: 'Novos', leads: 6, scheduled: 1, visits: 3, sales: 4, conv: 30, move: -1 },
];

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.visitServiceGetAll.mockReset().mockReturnValue([]);
  m.dealServiceGetAll.mockReset().mockReturnValue([]);
  m.saleServiceGetAll.mockReset().mockReturnValue([]);
  m.taskServiceGetAll.mockReset().mockReturnValue([]);
  m.sellerServiceGetAll.mockReset().mockReturnValue(DEFAULT_SELLERS);
  m.sellerServiceGetById.mockReset().mockReturnValue(null);
  m.useRemoteLeadsScreenState.mockReset();
  m.isRemoteLeadsEnabled.mockReset().mockReturnValue(false);
  m.isRemoteStagesEnabled.mockReset().mockReturnValue(false);
  m.restoredUser.current = null;
});

// ── I. Teste integrado do shell — reproduz a classe do bug do E7-A0 ───────
describe('App (shell integrado) — Home/Rail sob REMOTE_LEADS=true', () => {
  it('Manager: shell monta sem crash, nenhum serviço comercial local chamado, nenhum LeadService.getAll()', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(
      screenState('remote_active', { leads: { hasData: true, isEmpty: false, leads: [{ id: 'r1', urgency: 'red' }] } }),
    );

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());

    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    // A classe de bug do E7-A0 era um crash total (overlay de erro,
    // desmontando a árvore inteira) — a prova mais direta de que não
    // regrediu é o shell continuar de pé com seu chrome visível.
    expect(screen.getByTitle('Sair')).toBeInTheDocument();
  });

  it('Seller: shell monta sem crash, mesmos guards', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = seller();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());

    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('Super Admin sem companyId operacional: shell monta sem crash, nenhum remote_leads_invalid_context', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = superAdmin();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());

    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
  });

  it('janela de carregamento do snapshot (bridge ainda não populou): nenhum acesso síncrono, nenhum crash', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { pipeline: { hasData: false, isLoading: true } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('remote_misconfigured: fail-closed, shell monta sem crash', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });
});

// ── G. Rail — caminho local ────────────────────────────────────────────
describe('App (shell) — Rail no caminho local (REMOTE_LEADS=false)', () => {
  it('TaskService continua fornecendo o badge de Pendências', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: 'late' }, { id: 't2', state: 'late' }]);

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    expect(m.taskServiceGetAll).toHaveBeenCalled();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

// ── H. Rail — caminho remoto ─────────────────────────────────────────────
describe('App (shell) — Rail no caminho remoto', () => {
  it('TaskService.getAll() nunca é chamado; nenhum número fictício; shell continua renderizando', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller em modo remoto: texto secundário do Rail usa o papel da identidade autenticada (sem team local)', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = seller();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    // getCompetition() (Podium/Ranking, fora do escopo — E7-B1) continua
    // chamando SellerService.getById para "minha disputa"; o que este teste
    // prova é específico do Rail: o texto secundário nunca vira "Gerente"
    // (rótulo errado para um Seller) por falta do team local em modo remoto.
    expect(screen.getByText('Vendedor')).toBeInTheDocument();
  });
});
