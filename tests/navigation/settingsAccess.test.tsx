// Testes de navegação/acesso a Ajustes (M1-D, commit 8).
// App real + telas stubadas; flag mockada de forma controlada; troca de
// usuário simulada pelo fluxo público real (logout → login via AuthFlow).
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
  return { ...actual, isRemoteStagesEnabled: () => m.flag.current };
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
  ScreenAjustes: () => <div data-testid="screen-ajustes">AJUSTES-CONTENT</div>,
}));

vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function user(role: User['role']): User {
  return { id: `u-${role}`, name: role, email: `${role}@a.com`, role, sellerId: null, companyId: 'company-a' };
}

async function renderApp(initial: User | null) {
  m.restoredUser.current = initial;
  // App usa useQueryCacheIdentity (commit 9), que exige um QueryClientProvider
  // na árvore — igual à produção via AppProviders.
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
    m.restoredUser.current = next; // getCurrentUser passa a refletir o novo usuário
    fireEvent.click(screen.getByTestId('mock-login'));
  }
}

beforeEach(() => {
  m.flag.current = false;
  m.restoredUser.current = null;
  m.nextUser.current = null;
});

describe('menu Ajustes por role e flag', () => {
  it('admin vê Ajustes com flag OFF e com flag ON', async () => {
    await renderApp(user('admin'));
    expect(screen.getByText('Ajustes')).toBeInTheDocument();

    switchUser(user('admin'));
    m.flag.current = true;
    switchUser(user('admin'));
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
  });

  it('manager NÃO vê Ajustes com flag OFF e ScreenAjustes nunca renderiza', async () => {
    await renderApp(user('manager'));
    expect(screen.queryByText('Ajustes')).toBeNull();
    expect(screen.queryByTestId('screen-ajustes')).toBeNull();
  });

  it('manager vê Ajustes com flag ON', async () => {
    m.flag.current = true;
    await renderApp(user('manager'));
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ajustes'));
    expect(screen.getByTestId('screen-ajustes')).toBeInTheDocument();
  });

  it('seller não vê Ajustes com flag OFF nem ON', async () => {
    await renderApp(user('seller'));
    expect(screen.queryByText('Ajustes')).toBeNull();

    m.flag.current = true;
    switchUser(user('seller'));
    expect(screen.queryByText('Ajustes')).toBeNull();
    expect(screen.queryByTestId('screen-ajustes')).toBeNull();
  });

  it('usuário null não vê menu nenhum', async () => {
    await renderApp(null);
    expect(screen.getByTestId('mock-login')).toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).toBeNull();
  });
});

describe('troca de usuário com tela Ajustes aberta', () => {
  it('admin → manager com flag OFF: acesso removido imediatamente (volta para home)', async () => {
    await renderApp(user('admin'));
    fireEvent.click(screen.getByText('Ajustes'));
    expect(screen.getByTestId('screen-ajustes')).toBeInTheDocument();

    switchUser(user('manager'));
    expect(screen.queryByTestId('screen-ajustes')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).toBeNull();
  });

  it('admin → manager com flag ON: mantém somente o acesso permitido (Ajustes segue acessível)', async () => {
    m.flag.current = true;
    await renderApp(user('admin'));
    fireEvent.click(screen.getByText('Ajustes'));
    expect(screen.getByTestId('screen-ajustes')).toBeInTheDocument();

    switchUser(user('manager'));
    // Manager com flag ON mantém a tela Ajustes (a restrição às abas internas
    // é responsabilidade da própria ScreenAjustes, testada à parte).
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
    expect(screen.getByTestId('screen-ajustes')).toBeInTheDocument();
  });

  it('manager → seller com flag ON: remove acesso a Ajustes', async () => {
    m.flag.current = true;
    await renderApp(user('manager'));
    fireEvent.click(screen.getByText('Ajustes'));
    expect(screen.getByTestId('screen-ajustes')).toBeInTheDocument();

    switchUser(user('seller'));
    expect(screen.queryByTestId('screen-ajustes')).toBeNull();
    expect(screen.queryByText('Ajustes')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeInTheDocument();
  });
});
