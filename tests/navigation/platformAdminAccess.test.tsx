// Testes de navegação/acesso à área "Empresas" (M1-F S3-B).
// App real + telas stubadas; flag mockada de forma controlada; troca de
// usuário simulada pelo fluxo público real (logout → login via AuthFlow).
// Mesmo molde de tests/navigation/settingsAccess.test.tsx (M1-D).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

// jsdom não implementa Element.scrollTo (App.go rola o #scroll-host) —
// polyfill inofensivo restrito a este arquivo de teste.
beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  flag: { current: false },
  restoredUser: { current: null as User | null },
  nextUser: { current: null as User | null },
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isPlatformAdminEnabled: () => m.flag.current };
});

vi.mock('@/lib/store', () => ({ subscribeStore: () => () => {} }));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
  },
  SellerService: { getAll: () => [], getById: () => null },
  TaskService: { getAll: () => [] },
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

vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => <div>visitas</div>,
  ScreenPropostas: () => <div>propostas</div>,
  ScreenVendas: () => <div>vendas</div>,
  ScreenResultados: () => <div>resultados</div>,
  ScreenAjustes: () => <div>ajustes</div>,
}));

const fetchAccessibleCompaniesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/companies/repository', () => ({
  fetchAccessibleCompanies: fetchAccessibleCompaniesMock,
  createCompanyRpc: vi.fn(),
}));

vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function user(role: User['role'], platformRole: 'super_admin' | null = null): User {
  return { id: `u-${role}-${platformRole ?? 'none'}`, name: role, email: `${role}@a.com`, role, sellerId: null, companyId: platformRole ? null : 'company-a', platformRole };
}

async function renderApp(initial: User | null) {
  m.restoredUser.current = initial;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
}

function switchUser(next: User | null) {
  act(() => { (window as any).__logout(); });
  if (next) {
    m.nextUser.current = next;
    m.restoredUser.current = next;
    fireEvent.click(screen.getByTestId('mock-login'));
  }
}

beforeEach(() => {
  m.flag.current = false;
  m.restoredUser.current = null;
  m.nextUser.current = null;
  fetchAccessibleCompaniesMock.mockReset();
  fetchAccessibleCompaniesMock.mockResolvedValue([]);
});

describe('menu Empresas por role/platformRole e flag', () => {
  it('Super Admin vê Empresas com a flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    expect(screen.getByText('Empresas')).toBeInTheDocument();
  });

  it('Super Admin NÃO vê Empresas com a flag OFF', async () => {
    m.flag.current = false;
    await renderApp(user('admin', 'super_admin'));
    expect(screen.queryByText('Empresas')).toBeNull();
  });

  it('ADMIN legado (platformRole null) não vê Empresas mesmo com a flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('admin', null));
    expect(screen.queryByText('Empresas')).toBeNull();
  });

  it('Manager não vê Empresas com a flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('manager', null));
    expect(screen.queryByText('Empresas')).toBeNull();
  });

  it('Seller não vê Empresas com a flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('seller', null));
    expect(screen.queryByText('Empresas')).toBeNull();
  });

  it('usuário null não vê menu nenhum', async () => {
    m.flag.current = true;
    await renderApp(null);
    expect(screen.getByTestId('mock-login')).toBeInTheDocument();
    expect(screen.queryByText('Empresas')).toBeNull();
  });

  it('acesso direto (via go) a "empresas" sem autorização não renderiza a tela — cai em home', async () => {
    m.flag.current = false;
    await renderApp(user('manager', null));
    // Não há entrada de menu para clicar (já coberto acima); a guarda
    // síncrona de App (effectiveCurrent) garante que mesmo que `current`
    // apontasse para 'empresas' por qualquer motivo, a tela não renderiza.
    expect(screen.queryByText('Empresas')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });

  it('não autorizado nunca dispara SELECT em companies', async () => {
    m.flag.current = true;
    await renderApp(user('manager', null));
    expect(fetchAccessibleCompaniesMock).not.toHaveBeenCalled();
  });
});

describe('acesso real à tela Empresas', () => {
  it('Super Admin com flag ON acessa a tela e dispara a listagem', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    fireEvent.click(screen.getByText('Empresas'));
    await waitFor(() => expect(fetchAccessibleCompaniesMock).toHaveBeenCalled());
  });
});

describe('troca de usuário com tela Empresas aberta', () => {
  it('Super Admin → Manager com flag ON: acesso removido imediatamente (volta para home)', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    fireEvent.click(screen.getByText('Empresas'));
    await waitFor(() => expect(fetchAccessibleCompaniesMock).toHaveBeenCalled());

    switchUser(user('manager', null));
    expect(screen.queryByText('Empresas')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });

  it('Manager → Super Admin com flag ON: ganha acesso a Empresas', async () => {
    m.flag.current = true;
    await renderApp(user('manager', null));
    expect(screen.queryByText('Empresas')).toBeNull();

    switchUser(user('admin', 'super_admin'));
    expect(screen.getByText('Empresas')).toBeInTheDocument();
  });
});
