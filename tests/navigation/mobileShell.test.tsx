// tests/navigation/mobileShell.test.tsx
// MOBILE-RESPONSIVENESS-V1-B1-EXEC §32-§35 — shell desktop x shell mobile.
// App real + telas stubadas (mesmo molde de settingsAccess.test.tsx /
// superAdminOperationalNavGuard.test.tsx), variando window.innerWidth.
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});
afterEach(() => {
  setWidth(ORIGINAL_WIDTH);
});

const m = vi.hoisted(() => ({
  restoredUser: { current: null as User | null },
  nextUser: { current: null as User | null },
}));

vi.mock('@/lib/store', () => ({ subscribeStore: () => () => {} }));

const opContext = {
  current: {
    mode: 'none' as 'none' | 'super_admin',
    companyId: null as string | null,
    identity: { status: 'unavailable' } as
      | { status: 'unavailable' }
      | { status: 'ready'; company: { name: string; logoPath: string | null } },
    isReadOnly: false,
  },
};
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => opContext.current,
  OperationalCompanyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
    isManager: () => false,
  },
  SellerService: { getAll: () => [], getById: () => null },
  TaskService: { getAll: () => [] },
  PipelineService: { getStages: () => [] },
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
    <button data-testid="mock-login" onClick={() => m.nextUser.current && onAuthed(m.nextUser.current)}>mock-login</button>
  ),
}));

vi.mock('@/components/screens/Home', () => ({ Home: () => <div data-testid="screen-home">home</div> }));
vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => <div data-testid="screen-clientes">clientes</div>,
  ScreenAndamento: () => <div data-testid="screen-andamento">andamento</div>,
  ScreenPendencias: () => <div data-testid="screen-pendencias">pendencias</div>,
}));
vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => <div data-testid="screen-visitas">visitas</div>,
  ScreenPropostas: () => <div data-testid="screen-propostas">propostas</div>,
  ScreenVendas: () => <div data-testid="screen-vendas">vendas</div>,
  ScreenResultados: () => <div data-testid="screen-resultados">resultados</div>,
  ScreenAjustes: () => <div data-testid="screen-ajustes">ajustes</div>,
}));
vi.mock('@/components/screens/ScreenEmpresas', () => ({ ScreenEmpresas: () => <div data-testid="screen-empresas">empresas</div> }));
vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

function user(label: string, platformRole: 'super_admin' | null = null, activeMembership: User['activeMembership'] = null): User {
  return { id: `u-${label}`, name: label, email: `${label}@a.com`, platformRole, activeMembership };
}
const manager = () => user('manager', null, { companyId: 'company-a', role: 'manager', sellerId: null });
const seller = () => user('seller', null, { companyId: 'company-a', role: 'seller', sellerId: null });
const superAdmin = () => user('admin', 'super_admin');

async function renderApp(u: User | null, width: number, operationalCompanyId?: string) {
  setWidth(width);
  m.restoredUser.current = u;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App operationalCompanyId={operationalCompanyId ?? null} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
}

function navLabelsIn(container: HTMLElement): string[] {
  const nav = container.querySelector('nav');
  if (!nav) return [];
  return Array.from(nav.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter(Boolean);
}

beforeEach(() => {
  m.restoredUser.current = null;
  m.nextUser.current = null;
  opContext.current = { mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false };
});

describe('§32 — shell desktop (>= 1024)', () => {
  it('Rail inline presente; sem MobileHeader/Drawer', async () => {
    await renderApp(manager(), 1280);
    expect(document.querySelector('aside')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir navegação' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull();
    expect(screen.getByText('Início')).toBeInTheDocument();
  });

  it('no limiar exato 1024 ainda é desktop', async () => {
    await renderApp(manager(), 1024);
    expect(document.querySelector('aside')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir navegação' })).toBeNull();
  });
});

describe('§33 — shell mobile (< 1024)', () => {
  it('1023 já é mobile: sem <aside> inline, com hambúrguer; Drawer fechado não é acessível', async () => {
    await renderApp(manager(), 1023);
    expect(document.querySelector('aside')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir navegação' })).toBeInTheDocument();
    // Drawer montado porém fechado (visibility:hidden) → inacessível.
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull();
  });

  it('hambúrguer abre o Drawer com a MESMA lista de nav; nav-click navega e fecha', async () => {
    await renderApp(manager(), 390);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const dialog = screen.getByRole('dialog', { name: 'Navegação' });
    expect(within(dialog).getByText('Início')).toBeInTheDocument();
    expect(within(dialog).getByText('Clientes')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Clientes'));
    expect(screen.getByTestId('screen-clientes')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull(); // §13 — fechou
  });

  it('ESC fecha o Drawer', async () => {
    await renderApp(manager(), 390);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    expect(screen.getByRole('dialog', { name: 'Navegação' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull();
  });

  it('clique no scrim fecha o Drawer', async () => {
    await renderApp(manager(), 390);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    expect(screen.getByRole('dialog', { name: 'Navegação' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-drawer-scrim'));
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull();
  });

  it('foco vai para dentro do Drawer ao abrir e volta ao hambúrguer ao fechar', async () => {
    await renderApp(manager(), 390);
    const burger = screen.getByRole('button', { name: 'Abrir navegação' });
    burger.focus();
    fireEvent.click(burger);
    const dialog = screen.getByRole('dialog', { name: 'Navegação' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(burger));
  });
});

describe('§34 — paridade de nav mobile x desktop por papel', () => {
  for (const [label, make] of [['manager', manager], ['seller', seller], ['super admin global', superAdmin]] as const) {
    it(`${label}: Drawer mostra exatamente os mesmos itens do Rail`, async () => {
      await renderApp(make(), 1280);
      const desktopLabels = navLabelsIn(document.body);
      expect(desktopLabels.length).toBeGreaterThan(0);

      cleanup();

      await renderApp(make(), 390);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
      const dialog = screen.getByRole('dialog', { name: 'Navegação' });
      expect(navLabelsIn(dialog)).toEqual(desktopLabels);
    });
  }
});

describe('§35 — Super Admin no mobile', () => {
  it('contextual: Drawer com contexto completo, header com pílula compacta', async () => {
    opContext.current = {
      mode: 'super_admin',
      companyId: 'c1',
      identity: { status: 'ready', company: { name: 'Rcar Seminovos Gama', logoPath: null } },
      isReadOnly: false,
    };
    await renderApp(superAdmin(), 390, 'c1');
    // header compacto
    expect(screen.getByText(/SUPER ADMIN · Rcar Seminovos Gama/)).toBeInTheDocument();
    // drawer com contexto completo
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const dialog = screen.getByRole('dialog', { name: 'Navegação' });
    expect(within(dialog).getByText('VISUALIZANDO COMO SUPER ADMIN')).toBeInTheDocument();
    expect(within(dialog).getByText('Voltar para Empresas')).toBeInTheDocument();
  });

  it('global (sem contexto): nenhuma empresa implícita no header nem no Drawer', async () => {
    await renderApp(superAdmin(), 390);
    expect(screen.queryByText(/SUPER ADMIN ·/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const dialog = screen.getByRole('dialog', { name: 'Navegação' });
    expect(within(dialog).queryByText('VISUALIZANDO COMO SUPER ADMIN')).toBeNull();
    expect(within(dialog).queryByText('Voltar para Empresas')).toBeNull();
  });
});
