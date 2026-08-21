// lib/deals/mutationGeneration.ts — guarda de geração compartilhada pelas
// três mutations remotas de Deals (COMMERCIAL-REMOTE-DEALS-B2-B). Mesmo
// padrão exato de lib/visits/mutationGeneration.ts/
// lib/tasks/taskMutationGeneration.ts — Deals tem seu PRÓPRIO guard (não
// reusa o de Visits/Tasks): o guard em si é genérico (queryClient +
// geração), mas o erro que ele lança precisa vir do namespace de erro
// correto do domínio chamador (createDealIdentityChangedMutationError,
// lib/deals/errors.ts) — reusar o de outro domínio faria uma mutation de
// Deals lançar um remote_visits_mutation_identity_changed/
// remote_tasks_mutation_identity_changed, contaminando o namespace errado.
//
// Cobre AMBOS os caminhos de resolução da RPC — sucesso E rejeição — nunca
// só o caminho de sucesso.
//
// Sem React, sem Supabase — só orquestra: captura a geração ANTES da
// chamada, executa a função, e SEMPRE prioriza `identity_changed` sobre
// qualquer resultado/erro real de uma geração morta, tanto no caminho de
// sucesso quanto no de rejeição. `onConflictError` roda SOMENTE quando o
// erro é real (geração ainda válida) — é aqui, e não num `onError`
// separado do TanStack, que a decisão de invalidar por conflito
// (stale_write/deal_closed/deal_not_found) acontece: mantém a checagem de
// geração e a decisão de invalidar no MESMO bloco síncrono, sem depender
// de threading de contexto entre callbacks.
import type { QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { createDealIdentityChangedMutationError } from '@/lib/deals/errors';

export type DealMutationGenerationGuardOptions = {
  onConflictError?: (error: unknown) => void;
};

export async function runDealMutationWithGenerationGuard<T>(
  queryClient: QueryClient,
  operation: string,
  fn: () => Promise<T>,
  options?: DealMutationGenerationGuardOptions,
): Promise<T> {
  const capturedGeneration = getQueryCacheGeneration(queryClient);

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    // Rejeição de uma geração morta: o erro real (stale_write/forbidden/
    // etc.) da sessão antiga NUNCA vaza para a sessão atual — vira
    // identity_changed, incondicionalmente, ANTES de qualquer decisão de
    // invalidação.
    if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
      throw createDealIdentityChangedMutationError(operation);
    }
    options?.onConflictError?.(error);
    throw error;
  }

  // Sucesso de uma geração morta: a escrita já aconteceu no servidor, mas
  // nunca pode aterrissar como sucesso da sessão nova.
  if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
    throw createDealIdentityChangedMutationError(operation);
  }

  return result;
}
