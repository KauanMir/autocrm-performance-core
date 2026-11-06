// WHATSAPP-W2B-8 — "Conversas" só existe para Super Admin operando a TEST COMPANY com
// a flag ligada. App real + telas stubadas, mesmo molde de
// superAdminOperationalNavGuard.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  inboxFlag: { current: false },
  restoredUser: { current: null as User | null },
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isWhatsAppInboxEnabled: () => m.inboxFlag.current };
});

vi.mock('@/lib/store', () => ({ subscribeStore: () => () => {} }));

const opContext = {
  current: { mode: 'none' as 'none' | 'super_admin' | 'membership', companyId: null as string | null, identity: { status: 'unavailable' }, isReadOnly: false },
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

vi.mock('@/components/auth/AuthFlow', () => ({ AuthFlow: () => null }));
vi.mock('@/components/screens/Home', () => ({ Home: () => <div data-testid="screen-home">home</div> }));
vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => null,
  ScreenAndamento: () => null,
  ScreenPendencias: () => null,
}));
vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => null,
  ScreenPropostas: () => null,
  ScreenVendas: () => null,
  ScreenResultados: () => null,
  ScreenAjustes: () => null,
}));
vi.mock('@/components/screens/ScreenEmpresas', () => ({ ScreenEmpresas: () => null }));
vi.mock('@/components/whatsappInbox/ScreenConversas', () => ({
  ScreenConversas: () => <div data-testid="screen-conversas">conversas</div>,
}));
vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID as TEST_COMPANY } from '@/lib/capabilities';

const PILOT_COMPANY = '22222222-2222-4222-8222-222222222222';

function user(platformRole: 'super_admin' | null, role: 'manager' | 'seller' | null = null): User {
  return {
    id: `u-${platformRole ?? role}`,
    name: 'Usuário Fictício',
    email: 'usuario@ficticio.test',
    platformRole,
    activeMembership: role ? ({ role, companyId: TEST_COMPANY } as User['activeMembership']) : null,
  };
}

async function renderApp(current: User) {
  m.restoredUser.current = current;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
}

const conversasButton = () => screen.queryByRole('button', { name: 'Conversas' });

beforeEach(() => {
  m.inboxFlag.current = true;
  m.restoredUser.current = null;
  opContext.current = { mode: 'super_admin', companyId: TEST_COMPANY, identity: { status: 'unavailable' }, isReadOnly: false };
});

describe('menu Conversas', () => {
  it('Super Admin na TEST COMPANY com flag: aparece e abre a tela', async () => {
    await renderApp(user('super_admin'));
    fireEvent.click(conversasButton() as HTMLElement);
    expect(await screen.findByTestId('screen-conversas')).toBeInTheDocument();
  });

  it('flag desligada: não aparece', async () => {
    m.inboxFlag.current = false;
    await renderApp(user('super_admin'));
    expect(conversasButton()).toBeNull();
  });

  it('Super Admin em concessionária: não aparece', async () => {
    opContext.current = { ...opContext.current, companyId: PILOT_COMPANY };
    await renderApp(user('super_admin'));
    expect(conversasButton()).toBeNull();
  });

  it('Super Admin fora do contexto de empresa: não aparece', async () => {
    opContext.current = { ...opContext.current, mode: 'none', companyId: null };
    await renderApp(user('super_admin'));
    expect(conversasButton()).toBeNull();
  });

  it.each(['manager', 'seller'] as const)('%s da própria TEST COMPANY: não aparece', async (role) => {
    opContext.current = { ...opContext.current, mode: 'membership' };
    await renderApp(user(null, role));
    expect(conversasButton()).toBeNull();
  });
});
