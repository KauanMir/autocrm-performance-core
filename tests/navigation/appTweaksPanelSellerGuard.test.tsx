// Teste de integração do botão "Ver Perfil do vendedor" no TweaksPanel de
// components/App.tsx (M1-E, E7-B1). Achado do E7-A0: o botão chamava
// SellerService.getAll()[0] (catálogo local, sem company_id, sem backend
// remoto) incondicionalmente, mesmo com a flag de leads remotos ligada.
// TweaksPanel real NÃO é mockado (diferente das demais suites de
// integração deste diretório, que sempre o substituem por `() => null`) —
// só `useTweaks`/`TweaksPanel` são trocados por um passthrough que
// renderiza os children direto, sem depender do estado aberto/fechado do
// painel real (irrelevante para o que este teste prova); TweakSection/
// TweakRadio/TweakToggle/TweakButton continuam sendo a implementação real,
// para inspecionar se o botão entra na árvore do App conforme o modo.
//
// PILOT-UI-TRUTH-FIXES-R1-EXEC §6/§7: App.tsx agora só monta <TweaksPanel>
// em NODE_ENV==='development' (achado BLOCKER do PILOT-UI-TRUTH-AUDIT-A1 —
// dev/QA tool exposta sem gate a usuários reais). Este arquivo testa o
// comportamento INTERNO do painel (que continua existindo para dev), então
// força NODE_ENV='development' — a ausência em produção tem cobertura
// própria (appTweaksPanelProductionGate.test.tsx).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
  restoredUser: { current: null as User | null },
  sellerServiceGetAll: vi.fn(),
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
  SellerService: { getAll: m.sellerServiceGetAll, getById: () => null },
  LeadService: { getAll: () => [] },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  // COMMERCIAL-REMOTE-B1-B3-B: Rail agora chama useRemoteTasksScreenState,
  // que compõe useRemoteLeadsScreenState → usePipelineStages, que lê
  // PipelineService.getStages() de forma síncrona e incondicional (mesmo
  // em modo local) — precisa existir no mock mesmo quando o teste não usa
  // Pipeline/Leads diretamente.
  PipelineService: { getStages: () => [] },
}));

vi.mock('@/components/ui/TweaksPanel', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useTweaks: () => [{ podium: 'B', anim: false, showRevenue: false }, vi.fn()],
    TweaksPanel: ({ children }: any) => <div data-testid="tweaks-panel">{children}</div>,
  };
});

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
  m.sellerServiceGetAll.mockReset().mockReturnValue([{ id: 's1', name: 'Marcos Silva' }]);
  m.restoredUser.current = manager();
});

describe('TweaksPanel — botão "Ver Perfil do vendedor" (M1-E E7-B1)', () => {
  it('modo local: botão aparece (comportamento preservado)', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('tweaks-panel')).toBeInTheDocument());
    expect(screen.getByText('Ver Perfil do vendedor')).toBeInTheDocument();
  });

  it('modo remoto: botão não aparece, SellerService.getAll nunca é chamado a partir do TweaksPanel', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    renderApp();
    await waitFor(() => expect(screen.getByTestId('tweaks-panel')).toBeInTheDocument());
    expect(screen.queryByText('Ver Perfil do vendedor')).toBeNull();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('remote_misconfigured (REMOTE_LEADS=true, REMOTE_STAGES=false): botão não aparece, fail-closed', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(false);
    renderApp();
    await waitFor(() => expect(screen.getByTestId('tweaks-panel')).toBeInTheDocument());
    expect(screen.queryByText('Ver Perfil do vendedor')).toBeNull();
    expect(m.sellerServiceGetAll).not.toHaveBeenCalled();
  });

  it('outros botões do painel (independentes de Seller) continuam presentes nos dois modos', async () => {
    m.isRemoteLeadsEnabled.mockReturnValue(true);
    m.isRemoteStagesEnabled.mockReturnValue(true);
    renderApp();
    await waitFor(() => expect(screen.getByTestId('tweaks-panel')).toBeInTheDocument());
    expect(screen.getByText('Ver Central de notificações')).toBeInTheDocument();
    expect(screen.getByText('Ver Busca global')).toBeInTheDocument();
    expect(screen.getByText('Ver Galeria de estados')).toBeInTheDocument();
  });
});
