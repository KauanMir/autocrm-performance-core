// Testes da geração de identidade do cache (M1-D, commit 9).
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bumpQueryCacheGeneration, getQueryCacheGeneration } from '@/lib/query/cacheIdentity';

describe('cacheIdentity', () => {
  it('QueryClient novo começa na geração 0', () => {
    expect(getQueryCacheGeneration(new QueryClient())).toBe(0);
  });

  it('bump incrementa e retorna a nova geração', () => {
    const qc = new QueryClient();
    expect(bumpQueryCacheGeneration(qc)).toBe(1);
    expect(bumpQueryCacheGeneration(qc)).toBe(2);
    expect(getQueryCacheGeneration(qc)).toBe(2);
  });

  it('QueryClients diferentes possuem gerações independentes', () => {
    const a = new QueryClient();
    const b = new QueryClient();
    bumpQueryCacheGeneration(a);
    bumpQueryCacheGeneration(a);
    expect(getQueryCacheGeneration(a)).toBe(2);
    expect(getQueryCacheGeneration(b)).toBe(0);
  });

  it('leitura não altera a geração', () => {
    const qc = new QueryClient();
    getQueryCacheGeneration(qc);
    getQueryCacheGeneration(qc);
    expect(getQueryCacheGeneration(qc)).toBe(0);
  });
});
