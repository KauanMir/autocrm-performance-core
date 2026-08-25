// PILOT-UI-TRUTH-FIXES-R1-EXEC §6/§7 — achado BLOCKER do
// PILOT-UI-TRUTH-AUDIT-A1: TweaksPanel (dev/QA tool, edit-mode via
// postMessage, revisão de telas de Auth, fixtures locais) renderizava sem
// nenhum gate de ambiente/role para todo usuário autenticado real
// (Manager/Seller/Super Admin). App.tsx agora só monta <TweaksPanel> em
// NODE_ENV==='development' — mesmo contrato de lib/flags.ts (resolveFlag).
// TweaksPanel real NÃO é mockado aqui (precisa provar que o próprio
// componente nem é montado em produção) — só os hooks que ele dependeria
// downstream (SellerService etc.) são mockados, mesmo padrão de
// appTweaksPanelSellerGuard.test.tsx.
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  restoredUser: { current: null as User | null },
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isRemoteLeadsEnabled: m.isRemoteLeadsEnabled,
    isRemoteStagesEnabled: m.isRemoteStagesEnabled,
  };
});

vi.mock('@/lib/hooks/useLeadsRemoteBridgeLifecycle', () => ({
  useLeadsRemoteBridgeLifecycle: () => {},
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}), subscribeStore: () => () => {} }));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: () => Promise.resolve(),
  },
  SellerService: { getAll: () => [{ id: 's1', name: 'Marcos Silva' }], getById: () => null },
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  PipelineService: { getStages: () => [] },
}));

vi.mock('@/components/auth/AuthFlow', () => ({
  AuthFlow: () => <div data-testid="auth-flow">login</div>,
}));
vi.mock('@/components/screens/Home', () => ({ Home: () => <div>home</div> }));
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

function superAdmin(): User {
  return { id: 'sa-1', name: 'Admin', email: 'a@a.com', platformRole: 'super_admin', activeMembership: null };
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.isRemoteLeadsEnabled.mockReset().mockReturnValue(false);
  m.isRemoteStagesEnabled.mockReset().mockReturnValue(false);
  m.restoredUser.current = manager();
});

describe('TweaksPanel — produção/preview (NODE_ENV padrão de teste, nunca "development")', () => {
  it('Manager: nenhum vestígio do painel monta na árvore', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(screen.queryByText('Ver Login')).toBeNull();
    expect(screen.queryByText('Ver Central de notificações')).toBeNull();
    expect(screen.queryByText('Ver Busca global')).toBeNull();
    expect(screen.queryByText('Ver Galeria de estados')).toBeNull();
    expect(screen.queryByText('Ver Perfil do vendedor')).toBeNull();
  });

  it('Super Admin: nenhum vestígio do painel monta na árvore (dev tool não é gate de role)', async () => {
    m.restoredUser.current = superAdmin();
    renderApp();
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(screen.queryByText('Ver Login')).toBeNull();
    expect(screen.queryByText('Ver Central de notificações')).toBeNull();
  });
});

describe('TweaksPanel — dev preview (NODE_ENV=development)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Manager: o painel monta e abre normalmente (o real TweaksPanel só mostra os children depois do postMessage __activate_edit_mode que o abre — mesmo contrato de edit-mode que já usava antes deste lote)', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: '__activate_edit_mode' } }));
    });
    await waitFor(() => expect(screen.getByText('Ver Login')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText('Ver Central de notificações')).toBeInTheDocument();
  });
});
