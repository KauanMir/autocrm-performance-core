// Testes de useTasksRemoteBridgeLifecycle (COMMERCIAL-REMOTE-B1-B2-B2-B).
// startTaskRemoteBridge mockado (já coberto em tests/tasks/taskBridge.test.ts)
// — aqui o alvo é o ciclo de vida: quando monta, quando desmonta, quando
// remonta, e a estabilidade do wrapper de `notify`.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTasksRemoteBridgeLifecycle } from '@/lib/hooks/useTasksRemoteBridgeLifecycle';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  startTaskRemoteBridge: vi.fn(),
  resolveTaskRemoteMode: vi.fn(),
}));

vi.mock('@/lib/tasks/taskBridge', () => ({
  startTaskRemoteBridge: mocks.startTaskRemoteBridge,
}));

vi.mock('@/lib/tasks/remoteTasksMode', () => ({
  resolveTaskRemoteMode: mocks.resolveTaskRemoteMode,
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
  mocks.startTaskRemoteBridge.mockReset();
  mocks.resolveTaskRemoteMode.mockReset();
  mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_ready');
  mocks.startTaskRemoteBridge.mockReturnValue(vi.fn());
});

// ── §27-31: quando monta / não monta ─────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — montagem (remote_ready, identidade válida)', () => {
  it('Manager com membership ativa monta a bridge exatamente uma vez', () => {
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-a', identityKey: 'user-1' }),
    );
  });

  it('Seller com membership ativa monta a bridge exatamente uma vez', () => {
    renderHook(
      () => useTasksRemoteBridgeLifecycle(
        manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }),
      ),
      { wrapper: createWrapper() },
    );
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });
});

describe('useTasksRemoteBridgeLifecycle — modo (§28/§29/§30)', () => {
  it('task_local ⇒ start = 0', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_local');
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });

  it('task_blocked ⇒ start = 0 (rollout parcial esperado, nunca tratado como erro)', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_blocked');
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });

  it('task_remote_misconfigured ⇒ start = 0', () => {
    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_misconfigured');
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });
});

describe('useTasksRemoteBridgeLifecycle — identidade inválida (§31)', () => {
  it('currentUser null (sem companyId/identityKey) ⇒ start = 0', () => {
    renderHook(() => useTasksRemoteBridgeLifecycle(null), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });

  it('sem membership ativa (companyId ausente) ⇒ start = 0', () => {
    renderHook(() => useTasksRemoteBridgeLifecycle(manager({ activeMembership: null })), { wrapper: createWrapper() });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });

  it('Super Admin (sem activeMembership, platformRole super_admin) ⇒ start = 0', () => {
    renderHook(
      () => useTasksRemoteBridgeLifecycle(manager({ activeMembership: null, platformRole: 'super_admin' })),
      { wrapper: createWrapper() },
    );
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });

  it('role inválido/desconhecido (nem manager nem seller) ⇒ start = 0', () => {
    renderHook(
      () => useTasksRemoteBridgeLifecycle(
        manager({ activeMembership: { companyId: 'company-a', role: 'unknown' as 'manager', sellerId: null } }),
      ),
      { wrapper: createWrapper() },
    );
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
  });
});

// ── §32: mode change → stop ───────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — mudança de modo desmonta a bridge', () => {
  it('remote_ready → task_blocked: stop exatamente uma vez, nenhum novo start', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);

    mocks.resolveTaskRemoteMode.mockReturnValue('task_blocked');
    rerender();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });

  it('remote_ready → task_remote_misconfigured: stop exatamente uma vez', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper });

    mocks.resolveTaskRemoteMode.mockReturnValue('task_remote_misconfigured');
    rerender();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });
});

// ── §33: company switch ────────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — troca de empresa (§11/§33)', () => {
  it('company A → B: stop A antes de start B, owner correto em cada chamada', () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValueOnce(stopA).mockReturnValueOnce(stopB);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);

    rerender({ user: manager({ activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } }) });
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(2);
    expect(mocks.startTaskRemoteBridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-b', identityKey: 'user-1' }),
    );
  });
});

// ── §34: identity switch ───────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — troca de identidade, mesma empresa (§12/§34)', () => {
  it('user A → user B: stop A antes de start B, nenhum reuse do bridge A', () => {
    const stopA = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValueOnce(stopA).mockReturnValueOnce(vi.fn());
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager({ id: 'user-1' }) },
    });
    rerender({ user: manager({ id: 'user-2' }) });
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-a', identityKey: 'user-2' }),
    );
  });

  it('logout (currentUser → null) desmonta a bridge anterior', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    rerender({ user: null });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ── §35: active change ─────────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — mudança de userIsActive (§14/§35)', () => {
  it('active → inactive (currentUser vira null, mesmo padrão de userIsActive=Boolean(currentUser)): stop', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
    rerender({ user: null });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('inactive → active com identidade válida: start novo', () => {
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: null as User | null },
    });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
    rerender({ user: manager() });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });
});

// ── §36: role change ────────────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — mudança de role (§13/§36)', () => {
  it('manager → role inválido: stop, nenhum novo start', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);

    rerender({ user: manager({ activeMembership: null }) }); // membership removida — cenário real (offboarding)
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });

  it('sem membership → seller válido: start', () => {
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager({ activeMembership: null }) },
    });
    expect(mocks.startTaskRemoteBridge).not.toHaveBeenCalled();
    rerender({ user: manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }) });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });
});

// ── §37: unmount ────────────────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — unmount', () => {
  it('unmount do componente desmonta a bridge exatamente uma vez', () => {
    const stop = vi.fn();
    mocks.startTaskRemoteBridge.mockReturnValue(stop);
    const wrapper = createWrapper();
    const { unmount } = renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper });
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ── §38: Strict Mode ────────────────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — React.StrictMode (§17/§38)', () => {
  it('cada start recebe seu cleanup correspondente; no máximo um bridge vivo em qualquer momento', () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    mocks.startTaskRemoteBridge.mockImplementation(() => {
      activeCount++;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      return () => {
        activeCount--;
      };
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </React.StrictMode>
    );

    const { unmount } = renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper });
    // Não exige um número fixo de chamadas de start (Strict Mode em dev
    // pode montar/desmontar o efeito duas vezes de propósito) — o que
    // importa: nunca mais de um bridge simultaneamente vivo, e ao final
    // da montagem exatamente um está ativo.
    expect(maxActiveCount).toBe(1);
    expect(activeCount).toBe(1);

    unmount();
    expect(activeCount).toBe(0);
  });
});

// ── §39: independência da query ────────────────────────────────────────

describe('useTasksRemoteBridgeLifecycle — independência de useTasks/query', () => {
  it('monta o bridge mesmo sem nenhuma task query no cache, sem chamar fetch', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
    // Nenhuma query foi criada/observada pelo QueryClient — o lifecycle
    // não chama useTasks nem dispara nenhum fetch.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

// ── notify: estabilidade do wrapper (§21/§22) ────────────────────────────

describe('useTasksRemoteBridgeLifecycle — notify', () => {
  it('notify inline recriado a cada render NÃO causa restart do bridge', () => {
    const wrapper = createWrapper();
    const { rerender } = renderHook(
      ({ n }: { n: () => void }) => useTasksRemoteBridgeLifecycle(manager(), n),
      { wrapper, initialProps: { n: () => {} } },
    );
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);

    rerender({ n: () => {} }); // nova referência de função a cada render
    rerender({ n: () => {} });
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1); // sem restart
  });

  it('o wrapper estável repassado ao bridge sempre invoca o `notify` MAIS RECENTE (nunca uma versão obsoleta)', () => {
    let capturedWrapper: (() => void) | undefined;
    mocks.startTaskRemoteBridge.mockImplementation((opts: { notify?: () => void }) => {
      capturedWrapper = opts.notify;
      return vi.fn();
    });

    const wrapper = createWrapper();
    const notifyA = vi.fn();
    const notifyB = vi.fn();
    const { rerender } = renderHook(
      ({ n }: { n: () => void }) => useTasksRemoteBridgeLifecycle(manager(), n),
      { wrapper, initialProps: { n: notifyA } },
    );

    capturedWrapper?.();
    expect(notifyA).toHaveBeenCalledTimes(1);
    expect(notifyB).not.toHaveBeenCalled();

    rerender({ n: notifyB }); // troca o callback SEM trocar identidade/mode
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1); // ainda o mesmo bridge

    capturedWrapper?.(); // mesmo wrapper de referência, mas já aponta para notifyB
    expect(notifyB).toHaveBeenCalledTimes(1);
    expect(notifyA).toHaveBeenCalledTimes(1); // não chamado de novo
  });

  it('sem notify algum: wrapper não lança ao ser invocado', () => {
    let capturedWrapper: (() => void) | undefined;
    mocks.startTaskRemoteBridge.mockImplementation((opts: { notify?: () => void }) => {
      capturedWrapper = opts.notify;
      return vi.fn();
    });
    renderHook(() => useTasksRemoteBridgeLifecycle(manager()), { wrapper: createWrapper() });
    expect(() => capturedWrapper?.()).not.toThrow();
  });
});

// ── sem duplicação em re-render com identidade idêntica ──────────────────

describe('useTasksRemoteBridgeLifecycle — nenhuma bridge duplicada', () => {
  it('re-render com a MESMA identidade (novo objeto, mesmos valores) não remonta', () => {
    const wrapper = createWrapper();
    const { rerender } = renderHook(({ user }: { user: User | null }) => useTasksRemoteBridgeLifecycle(user), {
      wrapper,
      initialProps: { user: manager() },
    });
    rerender({ user: manager() }); // novo objeto, mesmos valores primitivos
    expect(mocks.startTaskRemoteBridge).toHaveBeenCalledTimes(1);
  });
});
