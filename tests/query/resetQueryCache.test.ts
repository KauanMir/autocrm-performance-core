// Testes do reset seguro do QueryClient (M1-D, commit 9).
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';

function seededClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['company', 'a', 'pipeline-stages'], { ok: true });
  // Popula o mutation cache via API pública do cache.
  qc.getMutationCache().build(qc, { mutationFn: async () => null });
  return qc;
}

describe('resetQueryCache', () => {
  it('incrementa a geração', () => {
    const qc = seededClient();
    expect(getQueryCacheGeneration(qc)).toBe(0);
    resetQueryCache(qc);
    expect(getQueryCacheGeneration(qc)).toBe(1);
    resetQueryCache(qc);
    expect(getQueryCacheGeneration(qc)).toBe(2); // idempotente e reexecutável
  });

  it('remove queries do cache', () => {
    const qc = seededClient();
    expect(qc.getQueryData(['company', 'a', 'pipeline-stages'])).toBeDefined();
    resetQueryCache(qc);
    expect(qc.getQueryData(['company', 'a', 'pipeline-stages'])).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('remove mutations do cache', () => {
    const qc = seededClient();
    expect(qc.getMutationCache().getAll().length).toBeGreaterThan(0);
    resetQueryCache(qc);
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });

  it('inicia o cancelamento de queries', () => {
    const qc = seededClient();
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');
    resetQueryCache(qc);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('não lança quando cancelQueries rejeita', async () => {
    const qc = seededClient();
    vi.spyOn(qc, 'cancelQueries').mockRejectedValue(new Error('cancel-fail'));
    expect(() => resetQueryCache(qc)).not.toThrow();
    // Dá um tick para a rejeição ser absorvida sem unhandled rejection.
    await Promise.resolve();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('não afeta outro QueryClient', () => {
    const qc = seededClient();
    const other = seededClient();
    resetQueryCache(qc);
    expect(other.getQueryData(['company', 'a', 'pipeline-stages'])).toBeDefined();
    expect(getQueryCacheGeneration(other)).toBe(0);
  });
});
