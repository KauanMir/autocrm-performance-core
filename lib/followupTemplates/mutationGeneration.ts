// lib/followupTemplates/mutationGeneration.ts — guarda de geração
// compartilhada pelas mutations remotas de Follow-up Templates
// (FOLLOW-UP-TEMPLATES-A3-EXEC). Mesmo contrato exato de
// lib/tasks/taskMutationGeneration.ts (runTaskMutationWithGenerationGuard) —
// reimplementado aqui, não importado de lá, porque o erro de
// identity_changed precisa ser um RemoteFollowUpTemplatesError (domínio
// próprio), nunca um RemoteTasksError emprestado de outro domínio.
import type { QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { createFollowUpTemplateIdentityChangedMutationError } from '@/lib/followupTemplates/errors';

export type FollowUpTemplateMutationGenerationGuardOptions = {
  onConflictError?: (error: unknown) => void;
};

export async function runFollowUpTemplateMutationWithGenerationGuard<T>(
  queryClient: QueryClient,
  operation: string,
  fn: () => Promise<T>,
  options?: FollowUpTemplateMutationGenerationGuardOptions,
): Promise<T> {
  const capturedGeneration = getQueryCacheGeneration(queryClient);

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
      throw createFollowUpTemplateIdentityChangedMutationError(operation);
    }
    options?.onConflictError?.(error);
    throw error;
  }

  if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
    throw createFollowUpTemplateIdentityChangedMutationError(operation);
  }

  return result;
}
