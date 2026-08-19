// Teste de integração do AuthenticatedShellErrorBoundary com o shell real
// (M1-E, E7-A2). Renderiza <App /> de verdade — Rail real, boundary real —
// só Home é mockada (controlável para lançar sob demanda), evitando
// duplicar a cobertura já real de Home em
// tests/navigation/appHomeRailRemoteGuard.test.tsx (E7-A1). Mesmo padrão de
// mocks de tests/navigation/appCacheIdentity.test.tsx.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  restoredUser: { current: null as User | null },
  logout: vi.fn(),
  shouldThrow: { current: false },
}));

vi.mock('@/lib/hooks/useLeadsRemoteBridgeLifecycle', () => ({
  useLeadsRemoteBridgeLifecycle: () => {},
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: () => false, isRemoteStagesEnabled: () => false };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}), subscribeStore: () => () => {} }));

vi.mock('@/lib/services', () => ({
  AuthService: {
    restoreSession: () => Promise.resolve(m.restoredUser.current),
    getCurrentUser: () => m.restoredUser.current,
    logout: m.logout,
  },
  SellerService: { getAll: () => [], getById: () => null },
  TaskService: { getAll: () => [] },
  // COMMERCIAL-REMOTE-B1-B3-B: Rail agora chama useRemoteTasksScreenState,
  // que compõe useRemoteLeadsScreenState → usePipelineStages, que lê
  // PipelineService.getStages() de forma síncrona e incondicional (mesmo
  // em modo local) — precisa existir no mock mesmo quando o teste não usa
  // Pipeline/Leads diretamente.
  PipelineService: { getStages: () => [] },
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

// Home controlável — lança sob demanda para provar que o boundary contém o
// erro; não substitui a cobertura real de Home (E7-A1), que fica no outro
// arquivo de teste.
vi.mock('@/components/screens/Home', () => ({
  Home: () => {
    if (m.shouldThrow.current) throw new Error('erro inesperado de renderização — nunca deve aparecer na UI');
    return <div>home real (mock controlado)</div>;
  },
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

function seller(id: string, sellerId: string): User {
  return {
    id, name: 'Vendedor', email: `${id}@a.com`, platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId },
  };
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
  m.restoredUser.current = null;
  m.shouldThrow.current = false;
  m.logout.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── G. Integração com o shell real ──────────────────────────────────────
describe('App — AuthenticatedShellErrorBoundary integrado ao shell real', () => {
  it('erro inesperado numa tela filha (Home) é contido pelo boundary, sem crash não tratado no teste', async () => {
    m.restoredUser.current = manager();
    m.shouldThrow.current = true;

    renderApp();

    await waitFor(() => expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument());
    expect(screen.queryByText(/erro inesperado de renderização/)).toBeNull();
  });

  it('logout continua acessível a partir do fallback, mesmo com a tela quebrada', async () => {
    m.restoredUser.current = manager();
    m.shouldThrow.current = true;

    renderApp();

    await waitFor(() => expect(screen.getByText('Sair da conta')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sair da conta'));
    expect(m.logout).toHaveBeenCalledTimes(1);
  });

  it('"Tentar novamente" remonta a tela quando o erro deixa de ocorrer', async () => {
    m.restoredUser.current = manager();
    m.shouldThrow.current = true;

    renderApp();
    await waitFor(() => expect(screen.getByText('Não foi possível carregar esta área')).toBeInTheDocument());

    m.shouldThrow.current = false;
    fireEvent.click(screen.getByText('Tentar novamente'));

    expect(screen.getByText('home real (mock controlado)')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta área')).toBeNull();
  });

  it('logout é chamado a partir do fallback mesmo com identidade de vendedor (não depende do papel/tela quebrada)', async () => {
    m.restoredUser.current = seller('user-a', 's1');
    m.shouldThrow.current = true;

    renderApp();
    await waitFor(() => expect(screen.getByText('Sair da conta')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Sair da conta'));
    expect(m.logout).toHaveBeenCalledTimes(1);
  });

  // Cenário F (reset por troca de identidade via key) é coberto de forma
  // completa e determinística em tests/errors/AuthenticatedShellErrorBoundary.test.tsx
  // (rerender com key diferente/igual) — o mesmo mecanismo de key está
  // integrado em components/App.tsx via shellErrorResetKey.

  it('app saudável (Home não lança): Rail real, sem fallback, chrome do shell intacto', async () => {
    m.restoredUser.current = manager();
    m.shouldThrow.current = false;

    renderApp();

    await waitFor(() => expect(screen.getByText('AUTOCRM')).toBeInTheDocument());
    expect(screen.getByText('home real (mock controlado)')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar esta área')).toBeNull();
    expect(m.logout).not.toHaveBeenCalled();
  });
});
