// Integração de permissões (commit 10): App + Rail + ScreenAjustes +
// capabilities + usePipelineStages + useReorderStages REAIS. A troca de
// usuário passa pelo fluxo público (logout → login). Mockados somente:
// cliente Supabase, isRemoteStagesEnabled, serviços locais/identidade e as
// telas que não participam do fluxo (Home/Ops/Auth/Tweaks/FlowLayer).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../helpers/renderWithQueryClient';
import type { User } from '@/lib/data';

// jsdom não implementa Element.scrollTo (App.go rola o #scroll-host).
beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  flag: { current: false },
  reorderLocal: vi.fn(),
  restoredUser: { current: null as User | null },
  nextUser: { current: null as User | null },
  localNames: { current: [] as string[] },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: m.from, rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteStagesEnabled: () => m.flag.current };
});

vi.mock('@/lib/store', () => ({
  subscribeStore: () => () => {},
  useStore: () => ({}),
}));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — este teste monta o App REAL, que
// monta OperationalCompanyProvider incondicionalmente (mesmo padrão de
// CommercialCompanyProvider) — precisa de um passthrough, não só do hook.
// mode:'none' preserva 100% o comportamento anterior (Manager continua via
// activeMembership.companyId).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  OperationalCompanyProvider: ({ children }: { children: React.ReactNode }) => children,
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — Rail (dentro de App real) agora usa
// next/navigation's useRouter ("Voltar para Empresas"). App Router real
// exige contexto ausente neste harness de render isolado.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: [] }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [], getById: () => null },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [], getById: () => null },
  TaskService: { getAll: () => [] },
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
  },
  CompanyService: {
    get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: '' }),
    update: () => {},
  },
  PipelineService: { reorderStages: m.reorderLocal, getStages: () => m.localNames.current },
}));

vi.mock('@/components/ui/TweaksPanel', () => ({
  useTweaks: () => [{ podium: 'D', anim: false, showRevenue: false }, vi.fn()],
  TweaksPanel: () => null,
  TweakSection: () => null,
  TweakRadio: () => null,
  TweakToggle: () => null,
  TweakButton: () => null,
}));

vi.mock('@/components/auth/AuthFlow', () => ({
  AuthFlow: ({ onAuthed }: { onAuthed: (u: User) => void }) => (
    <button data-testid="mock-login" onClick={() => m.nextUser.current && onAuthed(m.nextUser.current)}>
      mock-login
    </button>
  ),
}));

vi.mock('@/components/screens/Home', () => ({
  Home: () => <div data-testid="screen-home">home</div>,
}));

vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => <div>clientes</div>,
  ScreenAndamento: () => <div>andamento</div>,
  ScreenPendencias: () => <div>pendencias</div>,
}));

vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

// ScreensBiz permanece REAL — é a integração navegação → ScreenAjustes.
import { App } from '@/components/App';

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

const ROWS = [
  { id: 'uuid-new',             code: 'new',             name: 'Novo',            sort_order: 0, is_terminal: false },
  { id: 'uuid-qualified',       code: 'qualified',       name: 'Qualificado',     sort_order: 1, is_terminal: false },
  { id: 'uuid-visit_scheduled', code: 'visit_scheduled', name: 'Visita agendada', sort_order: 2, is_terminal: false },
  { id: 'uuid-negotiation',     code: 'negotiation',     name: 'Em negociação',   sort_order: 3, is_terminal: false },
  { id: 'uuid-closing',         code: 'closing',         name: 'Fechamento',      sort_order: 4, is_terminal: true },
];

function mockSelect() {
  const order = vi.fn().mockReturnValue(Promise.resolve({ data: ROWS, error: null }));
  const select = vi.fn(() => ({ order }));
  m.from.mockReturnValue({ select });
}

// M1-F S8-D2-A: `label` só nomeia id/name/email — User não carrega mais
// papel algum próprio.
function user(label: string, id = `u-${label}`): User {
  return { id, name: label, email: `${label}@a.com` };
}

// M1-F S7-B — helper DIRECIONADO (não altera o `user()` genérico, usado por
// cenários que testam propositalmente ausência de acesso empresarial). Só
// para os testes que exercitam o reorder REMOTO de verdade (RPC real): esse
// caminho agora depende de activeMembership.companyId em ScreensBiz.tsx —
// sem fallback para o companyId legado. Mapeamento idêntico ao backfill
// real do M1-F S1 (admin/manager -> membership role 'manager').
function userWithActiveMembership(label: string, companyId = 'company-a', id = `u-${label}`): User {
  const membershipRole: 'manager' | 'seller' = label === 'seller' ? 'seller' : 'manager';
  return { ...user(label, id), activeMembership: { companyId, role: membershipRole, sellerId: null } };
}

async function renderApp(initial: User | null) {
  m.restoredUser.current = initial;
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
  return queryClient;
}

function switchUser(next: User | null) {
  act(() => { (window as any).__logout(); });
  if (next) {
    m.nextUser.current = next;
    m.restoredUser.current = next;
    fireEvent.click(screen.getByTestId('mock-login'));
  }
}

// O botão do menu lateral — o título da página (h1) não é botão, então o
// seletor por role continua único mesmo com a tela Ajustes aberta.
function navAjustes() {
  return screen.queryByRole('button', { name: 'Ajustes' });
}

async function openAjustesRemote() {
  fireEvent.click(navAjustes()!);
  await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());
}

function dragTo(fromTestId: string, toTestId: string) {
  fireEvent.dragStart(screen.getByTestId(fromTestId), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  fireEvent.drop(screen.getByTestId(toTestId), { dataTransfer: {} });
}

beforeEach(() => {
  m.flag.current = false;
  m.restoredUser.current = null;
  m.nextUser.current = null;
  m.localNames.current = LOCAL_NAMES;
  m.rpc.mockResolvedValue({ data: ROWS, error: null });
});

describe('fluxo de permissões — acesso por role e flag', () => {
  it('Super Admin + flag OFF: Usuários/Etapas (nunca Empresa) e reorder local por names, sem RPC nem Supabase', async () => {
    // COMPANY-SETTINGS-R1-EXEC: canAccessFullSettings foi removida — Empresa
    // é superfície exclusiva de Manager agora (canManageCompanySettings).
    // Super Admin continua vendo Usuários/Etapas (capabilities intocadas).
    await renderApp({ ...user('admin'), platformRole: 'super_admin' });
    fireEvent.click(navAjustes()!);

    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    // COMPANY-SETTINGS-R1-EXEC: Super Admin agora cai na aba 'Usuários' por
    // padrão (Empresa não existe mais para este ator) — Usuários é conteúdo
    // REAL (InviteList/company selector) e legitimamente chama
    // supabase.from() antes mesmo de navegar para Etapas. Reseta a
    // contagem aqui para isolar só o que a navegação para Etapas/reorder
    // LOCAL dispara (que deve continuar sendo zero Supabase).
    m.from.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));

    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.reorderLocal).toHaveBeenCalledWith([
      'Novo', 'Visita agendada', 'Em negociação', 'Fechamento', 'Qualificado',
    ]);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('Super Admin + flag ON: Usuários/Etapas (nunca Empresa), mas pipeline sem empresa real (sem membership) — Etapas mostra "Sessão indisponível"', async () => {
    // COMPANY-SETTINGS-R1-EXEC: Empresa nunca aparece para Super Admin (sem
    // company context). Super Admin nunca tem activeMembership (design) — o
    // pipeline real (usePipelineStages) desabilita a query sem companyId,
    // mesma regra de sempre, nunca alterada por esta etapa (§28.3/proibição
    // de tocar a lógica de empresa do pipeline). O reorder remoto REAL por
    // UUIDs continua coberto pelo teste de Manager com membership ativa,
    // logo abaixo — os dois papéis não podem mais coexistir num único ator.
    m.flag.current = true;
    mockSelect();
    const superAdmin: User = { ...user('seller'), platformRole: 'super_admin' };
    await renderApp(superAdmin);
    fireEvent.click(navAjustes()!);
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    // COMPANY-SETTINGS-R1-EXEC: Super Admin agora cai na aba 'Usuários' por
    // padrão (primeiro item permitido, já que Empresa não existe mais para
    // este ator) — Usuários é conteúdo REAL (InviteList/company selector) e
    // legitimamente chama supabase.from() antes mesmo de navegar para
    // Etapas. A asserção original ("m.from nunca chamado") media a ausência
    // de chamadas do PIPELINE/Etapas especificamente — reseta a contagem
    // aqui para isolar só o que a navegação para Etapas dispara.
    m.from.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    expect(screen.getByTestId('stages-remote-state'))
      .toHaveTextContent('Sessão indisponível. Entre novamente para gerenciar as etapas.');
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('manager + flag OFF: sem Ajustes na navegação, sem reorder local e sem RPC', async () => {
    await renderApp(user('manager'));
    expect(navAjustes()).toBeNull();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(m.reorderLocal).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('manager com membership ativa + flag ON: vê Empresa, Usuários e Etapas; reorder remoto funciona ao navegar explicitamente para Etapas', async () => {
    // COMPANY-SETTINGS-R1-EXEC: Manager com membership ativa agora vê
    // Empresa (canManageCompanySettings) ALÉM de Usuários (canManageInvites,
    // §4-F1) e Etapas (flag ON) — as três capabilities são independentes.
    // A aba padrão ('Empresa', primeiro item de allowedTabs) mostra o
    // fixture local (isLocalCommercialDataAllowed não é mockado neste
    // arquivo — flag remota de leads OFF por padrão no ambiente de teste).
    m.flag.current = true;
    mockSelect();
    await renderApp(userWithActiveMembership('manager'));
    fireEvent.click(navAjustes()!);

    // Matriz real de abas: Empresa, Usuários e Etapas presentes.
    expect(screen.getByRole('button', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();

    // Navegação explícita para Etapas.
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());

    dragTo('stage-row-new', 'stage-row-closing');
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });

  it('seller: sem Ajustes e sem reorder, com flag OFF e ON', async () => {
    await renderApp(user('seller'));
    expect(navAjustes()).toBeNull();

    m.flag.current = true;
    mockSelect();
    switchUser(user('seller', 'u-seller-2'));
    expect(navAjustes()).toBeNull();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });

  it('usuário null: nenhuma navegação, nenhuma capability, nenhuma chamada', async () => {
    await renderApp(null);
    expect(screen.getByTestId('mock-login')).toBeInTheDocument();
    expect(navAjustes()).toBeNull();
    expect(screen.queryByTestId('screen-home')).toBeNull();
    expect(m.from).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('fluxo de permissões — troca de usuário com Ajustes aberto', () => {
  it('Super Admin → manager com flag ON: aba Empresa aparece pela primeira vez; Manager com membership ativa vê Empresa/Usuários/Etapas conforme a matriz real', async () => {
    // COMPANY-SETTINGS-R1-EXEC: Super Admin nunca vê Empresa (allowedTabs
    // cai para 'Usuários', primeiro item permitido).
    m.flag.current = true;
    mockSelect();
    await renderApp({ ...user('admin'), platformRole: 'super_admin' });
    fireEvent.click(navAjustes()!);
    // Super Admin: sem Empresa, cai em 'Usuários' (primeiro item permitido).
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();

    // M1-F S7-B: transição para Manager com activeMembership real (nunca só
    // o role legado) — companyId coerente com a empresa de origem.
    switchUser(userWithActiveMembership('manager'));

    // Empresa aparece pela primeira vez (canManageCompanySettings, exclusiva
    // de Manager agora) — o `tab` state interno nunca foi alterado por
    // clique (ainda 'Empresa', valor inicial), então reaparece assim que
    // entra em allowedTabs, sem precisar clicar em nada.
    expect(screen.getByRole('button', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();

    // Navegação explícita para Etapas confirma carregamento remoto e reorder.
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());
    dragTo('stage-row-new', 'stage-row-closing');
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });

  it('Super Admin → manager com flag OFF: Ajustes removido e navegação volta para home', async () => {
    // M1-F S8-B1: fixture desatualizado — canAccessFullSettings migrou para
    // platformRole.
    await renderApp({ ...user('admin'), platformRole: 'super_admin' });
    fireEvent.click(navAjustes()!);
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();

    switchUser(user('manager'));
    expect(navAjustes()).toBeNull();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });

  it('manager → seller com flag ON: conteúdo desmontado e handlers antigos inertes', async () => {
    m.flag.current = true;
    mockSelect();
    // M1-F S7-B: Manager com membership ativa real (companyId da
    // membership, nunca do legado). Etapas pode não ser a aba padrão (ver
    // teste da matriz de abas acima) — navegação explícita antes de
    // exercitar pipeline/reorder.
    await renderApp(userWithActiveMembership('manager'));
    fireEvent.click(navAjustes()!);
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());

    // Guarda referências das linhas ANTES da troca.
    const oldRow = screen.getByTestId('stage-row-new');
    const oldTarget = screen.getByTestId('stage-row-closing');

    // Transição para Seller — mesma empresa (permanência), papel muda para
    // seller em activeMembership (nunca só o role legado). Seller nunca tem
    // acesso a Ajustes/Etapas, independente de possuir membership real —
    // preserva o objetivo original do teste (perda de acesso ao trocar de
    // papel), sem inventar ausência de membership onde não é o cenário.
    switchUser(userWithActiveMembership('seller'));
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(navAjustes()).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();

    // Disparar drag nos nós desmontados não aciona nenhum reorder.
    fireEvent.dragStart(oldRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(oldTarget, { dataTransfer: {} });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });
});
