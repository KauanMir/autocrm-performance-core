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
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TASK_STATE } from '@/lib/data';
import type { User } from '@/lib/data';

// PODIUM-VIEWPORT-FIT-R1-EXEC — Home real (não mockada neste arquivo)
// monta o Pódio via FitBox (components/ui/kit.tsx) em qualquer variante,
// inclusive B (desde este EXEC) — sem este polyfill, `new ResizeObserver`
// lança ReferenceError (ausente no jsdom por padrão), derrubando qualquer
// render que alcance a Home real.
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Badge de Pendências escopado ao próprio botão de nav — evita colidir com
// qualquer outro "2"/número solto renderizado por Home (não mockada neste
// arquivo) em telas que não são o foco deste teste.
function pendenciasBadge(): HTMLElement | null {
  const button = screen.getByText('Pendências').closest('button')!;
  return within(button).queryByText(/^\d+$/);
}

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  useRemoteLeadsScreenState: vi.fn(),
  useRemoteTasksScreenState: vi.fn(),
  useTasksRemoteBridgeLifecycle: vi.fn(),
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

// COMMERCIAL-REMOTE-B1-B3-B: Rail agora chama useRemoteTasksScreenState
// diretamente — mockado aqui pelo mesmo motivo/padrão de
// useRemoteLeadsScreenState acima (controlar o mode deterministicamente
// sem depender de lib/flags/QueryClient real).
vi.mock('@/lib/hooks/useRemoteTasksScreenState', () => ({
  useRemoteTasksScreenState: m.useRemoteTasksScreenState,
}));

// A bridge não é mockada por conveniência: é removida do caminho de Home
// por definição (achado do E7-A0/objetivo do E7-A1) — este teste prova que
// o shell nunca precisa dela para renderizar a Home remota.
vi.mock('@/lib/hooks/useLeadsRemoteBridgeLifecycle', () => ({
  useLeadsRemoteBridgeLifecycle: () => {},
}));

// useTasksRemoteBridgeLifecycle é um spy (não um no-op fixo) — a suíte "App
// — Task bridge lifecycle mount" abaixo verifica com quais argumentos o App
// realmente o chama. A lógica INTERNA do hook já tem cobertura própria em
// tests/hooks/useTasksRemoteBridgeLifecycle.test.tsx — não é reexercitada
// aqui, só o wiring (App chama o hook, com currentUser e um notify).
vi.mock('@/lib/hooks/useTasksRemoteBridgeLifecycle', () => ({
  useTasksRemoteBridgeLifecycle: m.useTasksRemoteBridgeLifecycle,
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

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — Rail (dentro de App real) agora usa
// next/navigation's useRouter ("Voltar para Empresas"). App Router real
// exige contexto ausente neste harness de render isolado.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

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

// COMMERCIAL-REMOTE-B1-B3-B: shape de UseRemoteTasksScreenStateResult
// (lib/hooks/useRemoteTasksScreenState.ts) — mesmo padrão de screenState()
// acima, para os testes de badge do Rail.
function taskScreenState(mode: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    mode, tasks: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: false, refetch: vi.fn(),
    ...over,
  };
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
  // Default deliberado: um mode de Tasks que NUNCA chama TaskService.getAll()
  // nem renderiza badge (task_blocked) — preserva o comportamento observável
  // de todos os testes pré-existentes deste arquivo (nenhum deles configura
  // o mode de Tasks explicitamente, exceto os describes G/H, que sobrescrevem).
  m.useRemoteTasksScreenState.mockReset().mockReturnValue(taskScreenState('task_blocked'));
  m.useTasksRemoteBridgeLifecycle.mockReset();
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
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());

    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    // M1-E E7-B1: Podium/Ranking/MinhaDisputa (SellerService, catálogo
    // local sem company_id/backend remoto) também nunca são consultados.
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
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
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());

    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });

  it('Super Admin sem companyId operacional: shell monta sem crash, nenhum remote_leads_invalid_context', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = superAdmin();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_unavailable_identity'));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());

    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.visitServiceGetAll).not.toHaveBeenCalled();
    expect(m.dealServiceGetAll).not.toHaveBeenCalled();
    expect(m.saleServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });

  it('janela de carregamento do snapshot (bridge ainda não populou): nenhum acesso síncrono, nenhum crash', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { pipeline: { hasData: false, isLoading: true } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('remote_misconfigured: fail-closed, shell monta sem crash', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_misconfigured'));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });
});

// ── G. Rail — caminho local ────────────────────────────────────────────
describe('App (shell) — Rail no caminho local (REMOTE_LEADS=false)', () => {
  it('TaskService continua fornecendo o badge de Pendências', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('local'));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_local'));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: 'late' }, { id: 't2', state: 'late' }]);

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
    // M1-E E7-B1: getCompetition() (Podium/Ranking de Home) também nunca
    // chama SellerService.getById/getAll em modo remoto.
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('Seller em modo remoto: texto secundário do Rail usa o papel da identidade autenticada (sem team local)', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    m.restoredUser.current = seller();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    // M1-E E7-B1: getCompetition() (Podium/Ranking de Home, fora do escopo
    // do Rail) não chama mais SellerService.getById em modo remoto — o que
    // este teste prova é específico do Rail: o texto secundário nunca vira
    // "Gerente" (rótulo errado para um Seller) por falta do team local.
    expect(screen.getByText('Vendedor')).toBeInTheDocument();
    expect(m.sellerServiceGetById).not.toHaveBeenCalled();
  });
});

// ── I. Rail — badge de Tasks remoto (COMMERCIAL-REMOTE-B1-B3-B) ───────────
describe('App (shell) — Rail: badge de Tasks por mode remoto', () => {
  it('task_remote_active com dado: badge conta LATE remoto, TaskService.getAll nunca chamado', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [
        { id: 't1', state: TASK_STATE.LATE },
        { id: 't2', state: TASK_STATE.LATE },
        { id: 't3', state: TASK_STATE.TODAY },
      ],
    }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()?.textContent).toBe('2');
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  // §31 do EXEC: prova direta do corte — mesmo com o TaskService (mock)
  // "contendo" 99 Tasks atrasadas, o badge remoto usa exclusivamente
  // remote.tasks (2 LATE), nunca TaskService.getAll().
  it('badge remoto ignora TaskService.getAll() mesmo quando ele teria dado errado', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.taskServiceGetAll.mockReturnValue(
      Array.from({ length: 99 }, (_, i) => ({ id: `stale-${i}`, state: TASK_STATE.LATE })),
    );
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      hasData: true,
      tasks: [
        { id: 't1', state: TASK_STATE.LATE },
        { id: 't2', state: TASK_STATE.LATE },
      ],
    }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()?.textContent).toBe('2');
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('task_remote_active + isLoading: badge ausente, nunca número stale/local', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isLoading: true }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('task_remote_active + isError: badge ausente, sem fallback local', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', { isError: true, error: new Error('x') }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it('task_remote_active + configError: badge ausente', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState('task_remote_active', {
      configError: { ok: false, reason: 'invalid_task_configuration', code: 'invalid_priority', taskId: 't1', rowIndex: 0 },
    }));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });

  it.each([
    ['task_blocked'],
    ['task_remote_misconfigured'],
    ['task_remote_unavailable_identity'],
  ] as const)('%s: badge ausente, TaskService.getAll não chamado', async (mode) => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));
    m.taskServiceGetAll.mockReturnValue([{ id: 't1', state: TASK_STATE.LATE }]);
    m.useRemoteTasksScreenState.mockReturnValue(taskScreenState(mode));

    renderApp();
    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());
    expect(pendenciasBadge()).toBeNull();
    expect(m.taskServiceGetAll).not.toHaveBeenCalled();
  });
});

// ── J. App — Task bridge lifecycle mount (COMMERCIAL-REMOTE-B1-B3-B) ──────
// Teste de wiring simples: prova que o App monta useTasksRemoteBridgeLifecycle
// com currentUser (incluindo null, pré-auth) e um notify — a lógica INTERNA
// do hook já está coberta em tests/hooks/useTasksRemoteBridgeLifecycle.test.tsx,
// não é reexercitada aqui.
describe('App — Task bridge lifecycle mount', () => {
  it('chamado com currentUser=null antes da sessão resolver, depois com o usuário real — sempre com um notify', async () => {
    m.restoredUser.current = manager();
    m.useRemoteLeadsScreenState.mockReturnValue(screenState('remote_active', { leads: { hasData: true, isEmpty: false } }));

    renderApp();

    // Primeiro render: restoreSession() ainda não resolveu (currentUser
    // começa null em App.tsx) — o hook é chamado incondicionalmente mesmo
    // assim, nunca dentro de um `if (currentUser)`.
    expect(m.useTasksRemoteBridgeLifecycle.mock.calls[0][0]).toBeNull();
    expect(m.useTasksRemoteBridgeLifecycle.mock.calls[0][1]).toEqual(expect.any(Function));

    await waitFor(() => expect(screen.getByText('KAPA CRM')).toBeInTheDocument());

    const lastCall = m.useTasksRemoteBridgeLifecycle.mock.calls.at(-1)!;
    expect(lastCall[0]).toEqual(manager());
    expect(lastCall[1]).toEqual(expect.any(Function));
  });
});
