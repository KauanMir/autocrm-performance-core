// lib/visits/mutationGeneration.ts — guarda de geração compartilhada pelas
// cinco mutations remotas de Visits (COMMERCIAL-REMOTE-VISITS-B2-B). Mesmo
// padrão exato de lib/tasks/taskMutationGeneration.ts — Visits tem seu
// PRÓPRIO guard (não reusa o de Tasks): o guard em si é genérico
// (queryClient + geração), mas o erro que ele lança precisa vir do
// namespace de erro correto do domínio chamador
// (createVisitIdentityChangedMutationError, lib/visits/errors.ts) — reusar
// o de Tasks faria uma mutation de Visits lançar um
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
// (stale_write/visit_closed/visit_not_found/invalid_status_transition)
// acontece: mantém a checagem de geração e a decisão de invalidar no
// MESMO bloco síncrono, sem depender de threading de contexto entre
// callbacks.
import type { QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { createVisitIdentityChangedMutationError } from '@/lib/visits/errors';

export type VisitMutationGenerationGuardOptions = {
  onConflictError?: (error: unknown) => void;
};

export async function runVisitMutationWithGenerationGuard<T>(
  queryClient: QueryClient,
  operation: string,
  fn: () => Promise<T>,
  options?: VisitMutationGenerationGuardOptions,
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
      throw createVisitIdentityChangedMutationError(operation);
    }
    options?.onConflictError?.(error);
    throw error;
  }

  // Sucesso de uma geração morta: a escrita já aconteceu no servidor, mas
  // nunca pode aterrissar como sucesso da sessão nova.
  if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
    throw createVisitIdentityChangedMutationError(operation);
  }

  return result;
}
