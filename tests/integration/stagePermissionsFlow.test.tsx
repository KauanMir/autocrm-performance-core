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

function user(role: User['role'], id = `u-${role}`): User {
  return { id, name: role, email: `${role}@a.com`, role, sellerId: null, companyId: 'company-a' };
}

// M1-F S7-B — helper DIRECIONADO (não altera o `user()` genérico, usado por
// cenários que testam propositalmente ausência de acesso empresarial). Só
// para os testes que exercitam o reorder REMOTO de verdade (RPC real): esse
// caminho agora depende de activeMembership.companyId em ScreensBiz.tsx —
// sem fallback para o companyId legado. Mapeamento idêntico ao backfill
// real do M1-F S1 (admin/manager -> membership role 'manager').
function userWithActiveMembership(role: User['role'], companyId = 'company-a', id = `u-${role}`): User {
  const membershipRole: 'manager' | 'seller' = role === 'seller' ? 'seller' : 'manager';
  return { ...user(role, id), activeMembership: { companyId, role: membershipRole } };
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
  it('admin + flag OFF: Ajustes completo (Empresa/Usuários/Etapas) e reorder local por names, sem RPC nem Supabase', async () => {
    await renderApp(user('admin'));
    fireEvent.click(navAjustes()!);

    expect(screen.getByRole('button', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));

    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.reorderLocal).toHaveBeenCalledWith([
      'Novo', 'Visita agendada', 'Em negociação', 'Fechamento', 'Qualificado',
    ]);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('admin + flag ON: Ajustes completo e reorder remoto real por UUIDs via RPC', async () => {
    m.flag.current = true;
    mockSelect();
    await renderApp(userWithActiveMembership('admin'));
    fireEvent.click(navAjustes()!);
    expect(screen.getByRole('button', { name: 'Empresa' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());

    dragTo('stage-row-new', 'stage-row-negotiation');
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][0]).toBe('reorder_pipeline_stages');
    expect(m.rpc.mock.calls[0][1].p_ordered_ids.every((id: string) => id.startsWith('uuid-'))).toBe(true);
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });

  it('manager + flag OFF: sem Ajustes na navegação, sem reorder local e sem RPC', async () => {
    await renderApp(user('manager'));
    expect(navAjustes()).toBeNull();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(m.reorderLocal).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });

  it('manager com membership ativa + flag ON: vê Usuários e Etapas (nunca Empresa); reorder remoto funciona ao navegar explicitamente para Etapas', async () => {
    // M1-F S7-B: um Manager com activeMembership real (companyId vindo dela,
    // nunca do legado currentUser.companyId) também vê a aba Usuários, por
    // canManageInvites (§4-F1) — "somente Etapas" deixou de ser verdade
    // assim que o pipeline passou a depender de uma membership real (o
    // cenário antigo só existia via o consumo legado que este S7-B remove
    // de propósito). A aba padrão pode não ser Etapas — por isso a
    // navegação para Etapas agora é EXPLÍCITA.
    m.flag.current = true;
    mockSelect();
    await renderApp(userWithActiveMembership('manager'));
    fireEvent.click(navAjustes()!);

    // Matriz real de abas: Usuários e Etapas presentes; Empresa nunca
    // (exclusiva de admin/fullSettingsAccess) — "Equipe" (título de
    // InviteList) agora aparece legitimamente dentro de Usuários, então
    // deixou de ser um proxy válido de "nenhum conteúdo administrativo".
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();

    // Navegação explícita — Etapas não é presumida como aba padrão.
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
  it('admin → manager com flag ON: aba administrativa some; Manager com membership ativa vê Usuários/Etapas conforme a matriz real', async () => {
    m.flag.current = true;
    mockSelect();
    await renderApp(user('admin'));
    fireEvent.click(navAjustes()!);
    // Admin cai na aba default 'Empresa' com o conteúdo administrativo.
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();

    // M1-F S7-B: transição para Manager com activeMembership real (nunca só
    // o role legado) — companyId coerente com a empresa de origem.
    switchUser(userWithActiveMembership('manager'));

    // Empresa nunca aparece para Manager. Usuários aparece por
    // canManageInvites (membership ativa real, §4-F1) — "somente Etapas"
    // deixou de ser verdade; não presumimos qual das duas é a aba padrão.
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();

    // Navegação explícita para Etapas confirma carregamento remoto e reorder.
    fireEvent.click(screen.getByRole('button', { name: 'Etapas' }));
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());
    dragTo('stage-row-new', 'stage-row-closing');
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.reorderLocal).not.toHaveBeenCalled();
  });

  it('admin → manager com flag OFF: Ajustes removido e navegação volta para home', async () => {
    await renderApp(user('admin'));
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
