// lib/query/resetQueryCache.ts — reset seguro do QueryClient (M1-D, commit 9).
// Usado nas mudanças de identidade (logout, troca de usuário/empresa,
// identidade inativa). Limpeza COMPLETA de propósito: remove query cache e
// mutation cache, cobrindo também futuras queries pessoais. Idempotente —
// chamar mais de uma vez é seguro.
import type { QueryClient } from '@tanstack/react-query';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

export function resetQueryCache(queryClient: QueryClient): void {
  // 1. Geração incrementada PRIMEIRO: qualquer operação em voo que confira a
  //    geração depois disso descarta o próprio resultado.
  bumpQueryCacheGeneration(queryClient);

  // 2. Cancela em paralelo e limpa IMEDIATAMENTE — não aguardamos o
  //    cancelamento, senão uma conclusão atrasada poderia apagar dados da
  //    identidade nova que chegassem entre o cancel e o clear.
  const cancellation = queryClient.cancelQueries();

  // 3. clear() remove query cache e mutation cache.
  queryClient.clear();

  // 4. Falha de cancelamento nunca vira unhandled rejection nem erro de UI.
  void cancellation.catch(() => {});
}
