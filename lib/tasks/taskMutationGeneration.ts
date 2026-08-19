// lib/tasks/taskMutationGeneration.ts — guarda de geração compartilhada
// pelas três mutations remotas de Tasks (COMMERCIAL-REMOTE-B1-B2-C2-A,
// correção obrigatória §0). Cobre AMBOS os caminhos de resolução da RPC —
// sucesso E rejeição — nunca só o caminho de sucesso.
//
// GAP REAL DO PRECEDENTE DE LEADS (documentado aqui, NUNCA corrigido em
// Leads neste lote — fora de escopo): useCreateLead/useUpdateLead/
// useArchiveLead/useMoveLeadToStage capturam a geração antes do `await
// repositoryCall(...)` e só a conferem de novo DEPOIS de um resultado bem-
// sucedido — não há nenhum try/catch ao redor da chamada. Se o repository
// REJEITA (stale_write, forbidden, etc.), o erro original propaga direto
// do `await`, sem nenhuma checagem de geração no caminho de erro. Uma
// rejeição chegando depois de logout/troca de empresa/membership NUNCA
// vira `identity_changed` em Leads hoje — apenas o código de erro real da
// sessão morta (LEADS MUTATION ERROR-GENERATION GAP: YES, ver relatório
// final desta etapa §4). Como nenhum dos quatro hooks define `onError`,
// nenhuma invalidation contamina a sessão nova nesse caso — mas o CÓDIGO
// de erro que chegaria a uma UI futura poderia estar rotulado errado. A
// base de Tasks já nasce sem esse gap; Leads não é tocado aqui.
//
// Sem React, sem Supabase — só orquestra: captura a geração ANTES da
// chamada, executa a função, e SEMPRE prioriza `identity_changed` sobre
// qualquer resultado/erro real de uma geração morta, tanto no caminho de
// sucesso quanto no de rejeição. `onConflictError` roda SOMENTE quando o
// erro é real (geração ainda válida) — é aqui, e não num `onError`
// separado do TanStack, que a decisão de invalidar por conflito
// (stale_write/task_completed/already_completed/task_not_found) acontece:
// mantém a checagem de geração e a decisão de invalidar no MESMO bloco
// síncrono, sem depender de threading de contexto entre callbacks.
import type { QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { createTaskIdentityChangedMutationError } from '@/lib/tasks/errors';

export type TaskMutationGenerationGuardOptions = {
  onConflictError?: (error: unknown) => void;
};

export async function runTaskMutationWithGenerationGuard<T>(
  queryClient: QueryClient,
  operation: string,
  fn: () => Promise<T>,
  options?: TaskMutationGenerationGuardOptions,
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
      throw createTaskIdentityChangedMutationError(operation);
    }
    options?.onConflictError?.(error);
    throw error;
  }

  // Sucesso de uma geração morta: a escrita já aconteceu no servidor, mas
  // nunca pode aterrissar como sucesso da sessão nova.
  if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
    throw createTaskIdentityChangedMutationError(operation);
  }

  return result;
}
