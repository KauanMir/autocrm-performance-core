// M1-F S8-D1: allowedNavIds (components/App.tsx) deixou de ler
// NAV_ROLES[user.role] — a lista-base de navegação passa a vir
// exclusivamente de platformRole (Super Admin) ou activeMembership.role
// (Manager/Seller), nunca do profiles.role legado isolado.
//
// Estes testes cobrem exatamente os dois cenários de "profile legado
// divergente" citados na tarefa: um profiles.role desatualizado/errado
// não deve influenciar a navegação quando platformRole/activeMembership
// dizem outra coisa. 'Resultados' é o sinal mais simples: está na base do
// Manager e do Super Admin, mas NUNCA na do Seller (lib/data.ts NAV_ROLES).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  restoredUser: { current: null as User | null },
}));

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
  AuthFlow: () => <button data-testid="mock-login">mock-login</button>,
}));

vi.mock('@/components/screens/Home', () => ({ Home: () => <div>home</div> }));
vi.mock('@/components/screens/ScreensOps', () => ({
  ScreenClientes: () => null, ScreenAndamento: () => null, ScreenPendencias: () => null,
}));
vi.mock('@/components/screens/ScreensBiz', () => ({
  ScreenVisitas: () => null, ScreenPropostas: () => null, ScreenVendas: () => null,
  ScreenResultados: () => null, ScreenAjustes: () => null,
}));
vi.mock('@/components/flows/FlowLayer', () => ({ FlowLayer: () => null }));

import { App } from '@/components/App';

async function renderApp(initial: User) {
  m.restoredUser.current = initial;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
}

describe('navegação: profiles.role legado divergente nunca decide a lista-base', () => {
  it('platformRole=null, activeMembership.role=seller, profiles.role="admin" (legado divergente) ⇒ nav de Seller (sem Resultados, sem Ajustes)', async () => {
    const user: User = {
      id: 'u-1', name: 'Divergente', email: 'div@a.com',
      role: 'admin', // legado, deliberadamente errado
      sellerId: null,
      platformRole: null,
      activeMembership: { companyId: 'company-a', role: 'seller' },
    };
    await renderApp(user);
    expect(screen.queryByText('Resultados')).toBeNull();
    expect(screen.queryByText('Ajustes')).toBeNull();
  });

  it('platformRole=super_admin, profiles.role="seller" (legado divergente) ⇒ nav de Super Admin (com Resultados e Ajustes)', async () => {
    const user: User = {
      id: 'u-2', name: 'Divergente', email: 'div2@a.com',
      role: 'seller', // legado, deliberadamente errado
      sellerId: null,
      platformRole: 'super_admin',
      activeMembership: null,
    };
    await renderApp(user);
    expect(screen.getByText('Resultados')).toBeInTheDocument();
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
  });
});
