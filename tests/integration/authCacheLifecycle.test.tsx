// Integração do ciclo de vida do cache (commit 10): AppProviders REAL (cria o
// QueryClient de produção e monta o AuthCacheBoundary real) + o hook
// useQueryCacheIdentity real + resetQueryCache + controle de geração reais.
// Mockado somente supabase.auth.onAuthStateChange; a "fronteira" que troca a
// identidade comercial é um harness mínimo que faz o papel do App.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { AppProviders } from '@/components/providers/AppProviders';
import { useQueryCacheIdentity, type QueryCacheIdentity } from '@/lib/hooks/useQueryCacheIdentity';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

const m = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  listeners: [] as AuthCallback[],
  unsubs: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { onAuthStateChange: m.onAuthStateChange } },
  isSupabaseConfigured: true,
}));

const KEY = ['company', 'company-a', 'pipeline-stages'];
const ACTIVE_A: QueryCacheIdentity = { userId: 'user-1', companyId: 'company-a', isActive: true };
const EMPTY: QueryCacheIdentity = { userId: null, companyId: null, isActive: false };

function IdentityBoundary({ identity, clientRef }: {
  identity: QueryCacheIdentity;
  clientRef: { current: QueryClient | null };
}) {
  clientRef.current = useQueryClient();
  useQueryCacheIdentity(identity);
  return null;
}

function mountApp(identity: QueryCacheIdentity = ACTIVE_A) {
  const clientRef = { current: null as QueryClient | null };
  const view = render(
    <AppProviders>
      <IdentityBoundary identity={identity} clientRef={clientRef} />
    </AppProviders>,
  );
  const setIdentity = (next: QueryCacheIdentity) => view.rerender(
    <AppProviders>
      <IdentityBoundary identity={next} clientRef={clientRef} />
    </AppProviders>,
  );
  return { qc: clientRef.current!, view, setIdentity };
}

function seed(qc: QueryClient) {
  qc.setQueryData(KEY, { ok: true });
  qc.getMutationCache().build(qc, { mutationFn: async () => null });
}

function fire(event: string, userId: string | null) {
  act(() => {
    for (const cb of [...m.listeners]) cb(event, userId ? { user: { id: userId } } : null);
  });
}

beforeEach(() => {
  m.listeners.length = 0;
  m.unsubs.length = 0;
  m.onAuthStateChange.mockImplementation((cb: AuthCallback) => {
    m.listeners.push(cb);
    const unsubscribe = vi.fn(() => {
      const index = m.listeners.indexOf(cb);
      if (index >= 0) m.listeners.splice(index, 1);
    });
    m.unsubs.push(unsubscribe);
    return { data: { subscription: { unsubscribe } } };
  });
});

describe('ciclo de vida — sessão estável mantém o cache', () => {
  it('primeira sessão ativa mantém o cache e não incrementa a geração', () => {
    const { qc } = mountApp(ACTIVE_A);
    fire('INITIAL_SESSION', 'user-1');
    seed(qc);
    expect(qc.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(qc)).toBe(0);
  });

  it('TOKEN_REFRESHED do mesmo usuário mantém o cache', () => {
    const { qc } = mountApp(ACTIVE_A);
    fire('INITIAL_SESSION', 'user-1');
    seed(qc);
    fire('TOKEN_REFRESHED', 'user-1');
    expect(qc.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(qc)).toBe(0);
  });

  it('rerender com objeto de identidade NOVO mas com os mesmos valores não limpa', () => {
    const { qc, setIdentity } = mountApp(ACTIVE_A);
    seed(qc);
    setIdentity({ ...ACTIVE_A });
    setIdentity({ ...ACTIVE_A });
    expect(qc.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(qc)).toBe(0);
  });
});

describe('ciclo de vida — mudanças de sessão limpam o cache', () => {
  it('SIGNED_OUT remove query cache e mutation cache', () => {
    const { qc } = mountApp(ACTIVE_A);
    fire('SIGNED_IN', 'user-1');
    seed(qc);
    fire('SIGNED_OUT', null);
    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });

  it('login de outro usuário não recebe dados anteriores (A → out → B e A → B direto)', () => {
    const { qc } = mountApp(ACTIVE_A);
    fire('SIGNED_IN', 'user-1');
    seed(qc);
    fire('SIGNED_OUT', null);
    fire('SIGNED_IN', 'user-2');
    expect(qc.getQueryData(KEY)).toBeUndefined();

    // Troca direta, sem SIGNED_OUT no meio.
    seed(qc);
    fire('SIGNED_IN', 'user-3');
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it('identidade comercial: user A → user B limpa', () => {
    const { qc, setIdentity } = mountApp(ACTIVE_A);
    seed(qc);
    setIdentity({ ...ACTIVE_A, userId: 'user-2' });
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it('mesma pessoa, company A → company B limpa', () => {
    const { qc, setIdentity } = mountApp(ACTIVE_A);
    seed(qc);
    setIdentity({ ...ACTIVE_A, companyId: 'company-b' });
    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(getQueryCacheGeneration(qc)).toBeGreaterThanOrEqual(1);
  });

  it('ativo → inativo limpa', () => {
    const { qc, setIdentity } = mountApp(ACTIVE_A);
    seed(qc);
    setIdentity({ ...ACTIVE_A, isActive: false });
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });
});

describe('ciclo de vida — respostas pendentes e isolamento', () => {
  it('resposta pendente da identidade antiga não repovoa o cache após o reset', async () => {
    const { qc } = mountApp(ACTIVE_A);
    fire('SIGNED_IN', 'user-1');

    let resolveFetch!: (v: unknown) => void;
    const prefetch = qc.prefetchQuery({
      queryKey: KEY,
      queryFn: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });

    fire('SIGNED_OUT', null);
    await act(async () => {
      resolveFetch({ daIdentidadeAntiga: true });
      await prefetch;
    });

    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('outra montagem de AppProviders (outro QueryClient) não é afetada', () => {
    const a = mountApp(ACTIVE_A);
    const b = mountApp(ACTIVE_A);
    expect(a.qc).not.toBe(b.qc);
    seed(a.qc);
    seed(b.qc);

    a.setIdentity({ ...ACTIVE_A, companyId: 'company-b' });

    expect(a.qc.getQueryData(KEY)).toBeUndefined();
    expect(b.qc.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(b.qc)).toBe(0);
  });

  it('listener é removido no unmount e rerender não duplica a assinatura', () => {
    const { view, setIdentity } = mountApp(ACTIVE_A);
    expect(m.onAuthStateChange).toHaveBeenCalledTimes(1);
    setIdentity(ACTIVE_A); // rerender da mesma árvore
    setIdentity({ ...ACTIVE_A });
    expect(m.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(m.listeners).toHaveLength(1);

    view.unmount();
    expect(m.unsubs[0]).toHaveBeenCalledTimes(1);
    expect(m.listeners).toHaveLength(0);
  });

  it('logout completo (evento GoTrue + identidade zerada) termina em estado seguro, sem exigir contagem exata de resets', () => {
    const { qc, setIdentity } = mountApp(ACTIVE_A);
    fire('SIGNED_IN', 'user-1');
    seed(qc);

    // As duas peças reagem ao mesmo logout — o estado FINAL é o que importa.
    fire('SIGNED_OUT', null);
    setIdentity(EMPTY);

    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
    expect(getQueryCacheGeneration(qc)).toBeGreaterThanOrEqual(1);

    // Novo login de outro usuário parte de um cache vazio.
    fire('SIGNED_IN', 'user-2');
    setIdentity({ userId: 'user-2', companyId: 'company-b', isActive: true });
    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });
});
