// lib/query/cacheIdentity.ts — geração de identidade do cache (M1-D, commit 9).
// Cada QueryClient tem um contador de "geração": operações assíncronas capturam
// a geração ao começar e conferem de novo antes de escrever no cache — se a
// identidade mudou no meio (logout/troca de usuário/empresa), a escrita é
// descartada. WeakMap: nenhum dado sensível armazenado (só um número por
// instância) e a instância continua coletável pelo GC. Sem React, sem Supabase.
import type { QueryClient } from '@tanstack/react-query';

const generations = new WeakMap<QueryClient, number>();

export function getQueryCacheGeneration(queryClient: QueryClient): number {
  return generations.get(queryClient) ?? 0;
}

export function bumpQueryCacheGeneration(queryClient: QueryClient): number {
  const next = getQueryCacheGeneration(queryClient) + 1;
  generations.set(queryClient, next);
  return next;
}
