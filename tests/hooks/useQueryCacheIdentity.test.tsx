// Testes de useQueryCacheIdentity (M1-D, commit 9).
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQueryCacheIdentity, type QueryCacheIdentity } from '@/lib/hooks/useQueryCacheIdentity';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const KEY = ['company', 'a', 'pipeline-stages'];

function setup(initial: QueryCacheIdentity) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(KEY, { ok: true });
  queryClient.getMutationCache().build(queryClient, { mutationFn: async () => null });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook((props: QueryCacheIdentity) => useQueryCacheIdentity(props), {
    wrapper, initialProps: initial,
  });
  return { queryClient, hook };
}

const ADMIN_A: QueryCacheIdentity = { userId: 'user-1', companyId: 'company-a', isActive: true };

describe('useQueryCacheIdentity', () => {
  it('primeira identidade ativa não limpa', () => {
    const { queryClient } = setup(ADMIN_A);
    expect(queryClient.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(queryClient)).toBe(0);
  });

  it('rerender com os mesmos valores (mesmo objeto ou objeto novo) não limpa', () => {
    const { queryClient, hook } = setup(ADMIN_A);
    hook.rerender(ADMIN_A);
    hook.rerender({ ...ADMIN_A }); // objeto novo, valores idênticos
    expect(queryClient.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(queryClient)).toBe(0);
  });

  it('company A → company B limpa e incrementa a geração', () => {
    const { queryClient, hook } = setup(ADMIN_A);
    hook.rerender({ ...ADMIN_A, companyId: 'company-b' });
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(getQueryCacheGeneration(queryClient)).toBe(1);
  });

  it('user A → user B limpa', () => {
    const { queryClient, hook } = setup(ADMIN_A);
    hook.rerender({ ...ADMIN_A, userId: 'user-2' });
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('ativo → inativo limpa', () => {
    const { queryClient, hook } = setup(ADMIN_A);
    hook.rerender({ ...ADMIN_A, isActive: false });
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('ativo → null limpa, inclusive o mutation cache', () => {
    const { queryClient, hook } = setup(ADMIN_A);
    hook.rerender({ userId: null, companyId: null, isActive: false });
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('estado inicial sem usuário → primeiro usuário ativo não limpa', () => {
    const { queryClient, hook } = setup({ userId: null, companyId: null, isActive: false });
    hook.rerender(ADMIN_A);
    expect(queryClient.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(queryClient)).toBe(0);
  });

  it('outra instância de QueryClient não é afetada', () => {
    const other = new QueryClient();
    other.setQueryData(KEY, { ok: true });
    const { hook } = setup(ADMIN_A);
    hook.rerender({ ...ADMIN_A, companyId: 'company-b' });
    expect(other.getQueryData(KEY)).toBeDefined();
    expect(getQueryCacheGeneration(other)).toBe(0);
  });
});
