// Teste da fiação de useQueryCacheIdentity no App (M1-D, commit 9).
// O hook é mockado — os helpers já são testados à parte; aqui validamos só os
// valores que o App fornece, independentes da feature flag.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@/lib/data';

beforeEach(() => {
  (Element.prototype as any).scrollTo = () => {};
});

const m = vi.hoisted(() => ({
  useQueryCacheIdentity: vi.fn(),
  restoredUser: { current: null as User | null },
  nextUser: { current: null as User | null },
}));

vi.mock('@/lib/hooks/useQueryCacheIdentity', () => ({
  useQueryCacheIdentity: m.useQueryCacheIdentity,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteStagesEnabled: () => false }; // flag OFF de propósito
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

function user(role: User['role'], id: string, companyId: string): User {
  return { id, name: role, email: `${role}@a.com`, role, sellerId: null, companyId };
}

function lastIdentity() {
  const calls = m.useQueryCacheIdentity.mock.calls;
  return calls[calls.length - 1][0];
}

describe('App → useQueryCacheIdentity', () => {
  it('usuário null fornece identidade vazia; usuário autenticado fornece id/companyId/isActive', async () => {
    m.restoredUser.current = null;
    render(<App />);
    // Ainda no gate de loading, o App já chamou o hook com identidade vazia.
    expect(lastIdentity()).toEqual({ userId: null, companyId: null, isActive: false });

    await waitFor(() => expect(screen.getByTestId('mock-login')).toBeInTheDocument());
    expect(lastIdentity()).toEqual({ userId: null, companyId: null, isActive: false });

    // Login: valores passam a refletir o usuário ativo.
    const admin = user('admin', 'user-admin', 'company-a');
    m.nextUser.current = admin;
    m.restoredUser.current = admin;
    fireEvent.click(screen.getByTestId('mock-login'));
    expect(lastIdentity()).toEqual({ userId: 'user-admin', companyId: 'company-a', isActive: true });
  });

  it('troca de usuário atualiza os valores fornecidos (flag OFF não interfere)', async () => {
    const admin = user('admin', 'user-admin', 'company-a');
    m.restoredUser.current = admin;
    render(<App />);
    await waitFor(() =>
      expect(lastIdentity()).toEqual({ userId: 'user-admin', companyId: 'company-a', isActive: true }));

    act(() => { (window as any).__logout(); });
    expect(lastIdentity()).toEqual({ userId: null, companyId: null, isActive: false });

    const manager = user('manager', 'user-mgr', 'company-b');
    m.nextUser.current = manager;
    m.restoredUser.current = manager;
    fireEvent.click(screen.getByTestId('mock-login'));
    expect(lastIdentity()).toEqual({ userId: 'user-mgr', companyId: 'company-b', isActive: true });
  });
});
