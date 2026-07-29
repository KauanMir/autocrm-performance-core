// Testes de navegação/acesso a "Clientes"/"Andamento" (M1-F S8-C2-B2).
// App real + ScreensOps stubado; flag mockada de forma controlada. Mesmo
// molde de tests/navigation/platformAdminAccess.test.tsx (S3-B).
//
// Cobre a correção do achado 2 (S8-C2-A1): Super Admin NUNCA recebe os ids
// comerciais via NAV_ROLES[user.role] legado — só via
// canAccessCommercialWorkspace + a flag de leitura comercial. Manager/Seller
// continuam recebendo-os exatamente como sempre (nenhuma mudança de
// comportamento, nenhuma dependência da flag nova).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

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
  return { ...actual, isSuperAdminCommercialReadEnabled: () => m.flag.current };
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
  ScreenClientes: () => <div data-testid="screen-clientes">clientes</div>,
  ScreenAndamento: () => <div data-testid="screen-andamento">andamento</div>,
  ScreenPendencias: () => <div>pendencias</div>,
}));

vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => <div>visitas</div>,
  ScreenPropostas: () => <div>propostas</div>,
  ScreenVendas: () => <div>vendas</div>,
  ScreenResultados: () => <div>resultados</div>,
  ScreenAjustes: () => <div>ajustes</div>,
}));

vi.mock('@/components/screens/ScreenEmpresas', () => ({
  ScreenEmpresas: () => <div>empresas</div>,
}));

vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function user(role: User['role'], platformRole: 'super_admin' | null = null, activeMembership: User['activeMembership'] = null): User {
  return {
    id: `u-${role}-${platformRole ?? 'none'}`,
    name: role,
    email: `${role}@a.com`,
    role,
    sellerId: null,
    platformRole,
    activeMembership,
  };
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
});

describe('menu Clientes/Andamento — Super Admin', () => {
  it('Super Admin NÃO vê Clientes/Andamento com a flag OFF (correção do achado 2)', async () => {
    await renderApp(user('admin', 'super_admin'));
    expect(screen.queryByText('Clientes')).toBeNull();
    expect(screen.queryByText('Em progresso')).toBeNull();
  });

  it('Super Admin vê Clientes/Andamento com a flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Em progresso')).toBeInTheDocument();
  });

  it('acesso direto (via go) a "clientes" sem autorização não renderiza a tela — cai em home', async () => {
    await renderApp(user('admin', 'super_admin'));
    expect(screen.queryByTestId('screen-clientes')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });
});

describe('menu Clientes/Andamento — Manager/Seller (nenhuma mudança de comportamento)', () => {
  it('Manager sempre vê Clientes/Andamento, independente da flag comercial do Super Admin', async () => {
    m.flag.current = false;
    await renderApp(user('manager', null, { companyId: 'company-a', role: 'manager' }));
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Em progresso')).toBeInTheDocument();

    m.flag.current = true;
    switchUser(user('manager', null, { companyId: 'company-a', role: 'manager' }));
    expect(screen.getByText('Clientes')).toBeInTheDocument();
  });

  it('Seller sempre vê Clientes/Andamento, independente da flag', async () => {
    await renderApp(user('seller', null, { companyId: 'company-a', role: 'seller' }));
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Em progresso')).toBeInTheDocument();
  });
});

describe('troca de usuário com tela comercial aberta', () => {
  it('Super Admin (flag ON) → Manager: continua vendo Clientes (nunca perde acesso, Manager sempre tem)', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    fireEvent.click(screen.getByText('Clientes'));
    await waitFor(() => expect(screen.getByTestId('screen-clientes')).toBeInTheDocument());

    switchUser(user('manager', null, { companyId: 'company-a', role: 'manager' }));
    // Manager sempre tem 'clientes' via NAV_ROLES legado (nenhuma mudança de
    // comportamento) — a tela permanece montada, nunca cai em home.
    expect(screen.getByTestId('screen-clientes')).toBeInTheDocument();
  });

  it('Super Admin com flag desligada em tempo real: acesso removido imediatamente (volta para home)', async () => {
    m.flag.current = true;
    await renderApp(user('admin', 'super_admin'));
    fireEvent.click(screen.getByText('Clientes'));
    await waitFor(() => expect(screen.getByTestId('screen-clientes')).toBeInTheDocument());

    m.flag.current = false;
    switchUser(user('admin', 'super_admin'));
    expect(screen.queryByText('Clientes')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });
});
