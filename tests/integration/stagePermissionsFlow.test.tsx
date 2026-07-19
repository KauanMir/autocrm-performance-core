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
    await renderApp(user('admin'));
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

  it('manager + flag ON: somente a aba Etapas com reorder remoto; nenhuma outra configuração montada', async () => {
    m.flag.current = true;
    mockSelect();
    await renderApp(user('manager'));
    await openAjustesRemote();

    // Só Etapas: nem chips nem conteúdo de Empresa/Usuários.
    expect(screen.getByRole('button', { name: 'Etapas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuários' })).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.queryByText('Equipe')).toBeNull();

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
  it('admin → manager com flag ON: a tela passa a mostrar somente Etapas', async () => {
    m.flag.current = true;
    mockSelect();
    await renderApp(user('admin'));
    fireEvent.click(navAjustes()!);
    // Admin cai na aba default 'Empresa' com o conteúdo administrativo.
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();

    switchUser(user('manager'));
    // Manager mantém a tela, mas o conteúdo administrativo desaparece.
    await waitFor(() => expect(screen.getByTestId('stage-row-new')).toBeInTheDocument());
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuários' })).toBeNull();
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
    await renderApp(user('manager'));
    await openAjustesRemote();

    // Guarda referências das linhas ANTES da troca.
    const oldRow = screen.getByTestId('stage-row-new');
    const oldTarget = screen.getByTestId('stage-row-closing');

    switchUser(user('seller'));
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
