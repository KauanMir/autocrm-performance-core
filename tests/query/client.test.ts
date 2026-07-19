// Smoke tests da factory do QueryClient (M1-D, commit 2).
// Defaults lidos pela API pública getDefaultOptions() — nada de internals.
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createAppQueryClient } from '@/lib/query/client';

describe('createAppQueryClient', () => {
  it('retorna uma instância de QueryClient', () => {
    const client = createAppQueryClient();
    expect(client).toBeInstanceOf(QueryClient);
  });

  it('retorna instâncias diferentes a cada chamada (sem singleton global)', () => {
    const a = createAppQueryClient();
    const b = createAppQueryClient();
    expect(a).not.toBe(b);
  });

  it('não compartilha estado de cache entre instâncias', () => {
    const a = createAppQueryClient();
    const b = createAppQueryClient();
    a.setQueryData(['probe'], 'valor-a');
    expect(a.getQueryData(['probe'])).toBe('valor-a');
    expect(b.getQueryData(['probe'])).toBeUndefined();
  });

  describe('defaults', () => {
    const defaults = createAppQueryClient().getDefaultOptions();

    it('queries.staleTime = 5 minutos', () => {
      expect(defaults.queries?.staleTime).toBe(5 * 60 * 1000);
    });

    it('queries.retry = 2', () => {
      expect(defaults.queries?.retry).toBe(2);
    });

    it('queries.refetchOnWindowFocus = true', () => {
      expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    });

    it('mutations.retry = 0', () => {
      expect(defaults.mutations?.retry).toBe(0);
    });
  });
});
