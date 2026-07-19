// Testes do AuthCacheBoundary (M1-D, commit 9).
// Só supabase.auth.onAuthStateChange é mockado — o callback é capturado e
// dirigido manualmente; subscription falsa com unsubscribe spy.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthCacheBoundary } from '@/components/providers/AuthCacheBoundary';

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

const m = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  callback: { current: null as AuthCallback | null },
  unsubscribe: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { onAuthStateChange: m.onAuthStateChange } },
  isSupabaseConfigured: true,
}));

const KEY = ['company', 'a', 'pipeline-stages'];

function seed(qc: QueryClient) {
  qc.setQueryData(KEY, { ok: true });
  qc.getMutationCache().build(qc, { mutationFn: async () => null });
}

function renderBoundary() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(queryClient);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthCacheBoundary>
        <div data-testid="child">conteúdo</div>
      </AuthCacheBoundary>
    </QueryClientProvider>,
  );
  return { queryClient, view };
}

function fire(event: string, userId: string | null) {
  act(() => {
    m.callback.current?.(event, userId ? { user: { id: userId } } : null);
  });
}

beforeEach(() => {
  m.callback.current = null;
  m.onAuthStateChange.mockImplementation((cb: AuthCallback) => {
    m.callback.current = cb;
    return { data: { subscription: { unsubscribe: m.unsubscribe } } };
  });
});

describe('AuthCacheBoundary', () => {
  it('renderiza children', () => {
    renderBoundary();
    expect(screen.getByTestId('child')).toHaveTextContent('conteúdo');
  });

  it('INITIAL_SESSION com usuário não limpa', () => {
    const { queryClient } = renderBoundary();
    fire('INITIAL_SESSION', 'user-a');
    expect(queryClient.getQueryData(KEY)).toBeDefined();
  });

  it('TOKEN_REFRESHED do mesmo usuário não limpa', () => {
    const { queryClient } = renderBoundary();
    fire('INITIAL_SESSION', 'user-a');
    fire('TOKEN_REFRESHED', 'user-a');
    expect(queryClient.getQueryData(KEY)).toBeDefined();
  });

  it('SIGNED_IN repetido do mesmo usuário não limpa', () => {
    const { queryClient } = renderBoundary();
    fire('SIGNED_IN', 'user-a');
    seed(queryClient);
    fire('SIGNED_IN', 'user-a');
    expect(queryClient.getQueryData(KEY)).toBeDefined();
  });

  it('SIGNED_OUT limpa queries e mutations', () => {
    const { queryClient } = renderBoundary();
    fire('INITIAL_SESSION', 'user-a');
    fire('SIGNED_OUT', null);
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('troca direta user-a → user-b limpa', () => {
    const { queryClient } = renderBoundary();
    fire('SIGNED_IN', 'user-a');
    expect(queryClient.getQueryData(KEY)).toBeDefined();
    fire('SIGNED_IN', 'user-b');
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('primeiro login (null → user-a) não limpa desnecessariamente', () => {
    const { queryClient } = renderBoundary();
    fire('SIGNED_IN', 'user-a');
    expect(queryClient.getQueryData(KEY)).toBeDefined();
  });

  it('após SIGNED_OUT, novo login não reutiliza dados anteriores', () => {
    const { queryClient } = renderBoundary();
    fire('SIGNED_IN', 'user-a');
    fire('SIGNED_OUT', null);
    fire('SIGNED_IN', 'user-b');
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('unsubscribe é chamado no unmount e rerender não duplica listener', () => {
    const { queryClient, view } = renderBoundary();
    expect(m.onAuthStateChange).toHaveBeenCalledTimes(1);
    // Rerender com o MESMO QueryClient — nenhuma assinatura adicional.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AuthCacheBoundary>
          <div data-testid="child">conteúdo</div>
        </AuthCacheBoundary>
      </QueryClientProvider>,
    );
    expect(m.onAuthStateChange).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
