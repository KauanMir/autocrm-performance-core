// Testes de useLeadsRemoteBridgeLifecycle (M1-E, E3-B1). startLeadsRemoteBridge
// mockado (já coberto em tests/leads/bridge.test.ts) — aqui o alvo é o ciclo
// de vida: quando monta, quando desmonta, quando remonta.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeadsRemoteBridgeLifecycle } from '@/lib/hooks/useLeadsRemoteBridgeLifecycle';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  startLeadsRemoteBridge: vi.fn(),
  resolveRemoteLeadsFlagMode: vi.fn(),
}));

vi.mock('@/lib/leads/bridge', () => ({
  startLeadsRemoteBridge: mocks.startLeadsRemoteBridge,
}));

vi.mock('@/lib/leads/remoteLeadsMode', () => ({
  resolveRemoteLeadsFlagMode: mocks.resolveRemoteLeadsFlagMode,
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return wrapper;
}

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Gerente',
    email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.startLeadsRemoteBridge.mockReset();
  mocks.resolveRemoteLeadsFlagMode.mockReset();
  mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
  mocks.startLeadsRemoteBridge.mockReturnValue(vi.fn());
});

describe('useLeadsRemoteBridgeLifecycle — montagem', () => {
  it('Manager com membership ativa e modo remote_ready monta a bridge', () => {
    renderHook(() => useLeadsRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-a', identityKey: 'user-1' }),
    );
  });

  it('Seller com membership ativa monta a bridge', () => {
    renderHook(
      () => useLeadsRemoteBridgeLifecycle(manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } })),
      { wrapper: createWrapper() },
    );
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
  });

  it('Super Admin (sem activeMembership) nunca monta a bridge', () => {
    renderHook(() => useLeadsRemoteBridgeLifecycle(manager({ activeMembership: null, platformRole: 'super_admin' })), {
      wrapper: createWrapper(),
    });
    expect(mocks.startLeadsRemoteBridge).not.toHaveBeenCalled();
  });

  it('sem membership ativa nunca monta a bridge', () => {
    renderHook(() => useLeadsRemoteBridgeLifecycle(manager({ activeMembership: null })), { wrapper: createWrapper() });
    expect(mocks.startLeadsRemoteBridge).not.toHaveBeenCalled();
  });

  it('currentUser null nunca monta a bridge', () => {
    renderHook(() => useLeadsRemoteBridgeLifecycle(null), { wrapper: createWrapper() });
    expect(mocks.startLeadsRemoteBridge).not.toHaveBeenCalled();
  });

  it('modo local nunca monta a bridge', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    renderHook(() => useLeadsRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startLeadsRemoteBridge).not.toHaveBeenCalled();
  });

  it('modo remote_misconfigured nunca monta a bridge', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    renderHook(() => useLeadsRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startLeadsRemoteBridge).not.toHaveBeenCalled();
  });
});

describe('useLeadsRemoteBridgeLifecycle — ciclo de vida (troca de identidade)', () => {
  it('logout (currentUser → null) desmonta a bridge anterior', () => {
    const stop = vi.fn();
    mocks.startLeadsRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useLeadsRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
    rerender({ user: null });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('troca de empresa (A → B) desmonta a anterior e monta uma nova com o companyId novo', () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    mocks.startLeadsRemoteBridge.mockReturnValueOnce(stopA).mockReturnValueOnce(stopB);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useLeadsRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    rerender({ user: manager({ activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } }) });
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(2);
    expect(mocks.startLeadsRemoteBridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-b', identityKey: 'user-1' }),
    );
  });

  it('troca de usuário (mesma empresa) desmonta e remonta pela nova identityKey', () => {
    const stopA = vi.fn();
    mocks.startLeadsRemoteBridge.mockReturnValueOnce(stopA).mockReturnValueOnce(vi.fn());
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useLeadsRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager({ id: 'user-1' }) },
    });
    rerender({ user: manager({ id: 'user-2' }) });
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(mocks.startLeadsRemoteBridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-a', identityKey: 'user-2' }),
    );
  });

  it('desativação da flag (remote_ready → local) desmonta a bridge', () => {
    const stop = vi.fn();
    mocks.startLeadsRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(() => useLeadsRemoteBridgeLifecycle(manager()), { wrapper });
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    rerender();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
  });

  it('unmount do componente desmonta a bridge', () => {
    const stop = vi.fn();
    mocks.startLeadsRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { unmount } = renderHook(() => useLeadsRemoteBridgeLifecycle(manager()), { wrapper });
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('A → B → A é tratado como novo contexto a cada troca (3 start/stop, nunca reaproveita)', () => {
    const stopA1 = vi.fn();
    const stopB = vi.fn();
    const stopA2 = vi.fn();
    mocks.startLeadsRemoteBridge
      .mockReturnValueOnce(stopA1)
      .mockReturnValueOnce(stopB)
      .mockReturnValueOnce(stopA2);
    const wrapper = createWrapper();
    const companyA = manager({ activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } });
    const companyB = manager({ activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } });
    const { rerender } = renderHook(({ user }: { user: User | null }) => useLeadsRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: companyA },
    });
    rerender({ user: companyB });
    rerender({ user: companyA });

    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(3);
    expect(stopA1).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(stopA2).toHaveBeenCalledTimes(0);
    expect(mocks.startLeadsRemoteBridge.mock.calls.map((c) => c[0].companyId)).toEqual([
      'company-a', 'company-b', 'company-a',
    ]);
  });

  it('nenhuma bridge duplicada: re-render com a MESMA identidade não remonta', () => {
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useLeadsRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    rerender({ user: manager() }); // novo objeto, mesmos valores primitivos
    expect(mocks.startLeadsRemoteBridge).toHaveBeenCalledTimes(1);
  });
});
