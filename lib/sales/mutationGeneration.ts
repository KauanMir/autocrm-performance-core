// lib/sales/mutationGeneration.ts — guarda de geração para a mutation
// remota de Sales (COMMERCIAL-REMOTE-SALES-A2). Mesmo padrão exato de
// lib/deals/mutationGeneration.ts — Sales tem seu PRÓPRIO guard (não reusa
// o de Deals/Visits/Tasks): o guard em si é genérico (queryClient +
// geração), mas o erro que ele lança precisa vir do namespace de erro
// correto do domínio chamador (createSaleIdentityChangedMutationError,
// lib/sales/errors.ts) — reusar o de outro domínio faria a mutation de
// Sales lançar um remote_deals_mutation_identity_changed, contaminando o
// namespace errado.
//
// Cobre AMBOS os caminhos de resolução da RPC — sucesso E rejeição — nunca
// só o caminho de sucesso.
import type { QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { createSaleIdentityChangedMutationError } from '@/lib/sales/errors';

export type SaleMutationGenerationGuardOptions = {
  onConflictError?: (error: unknown) => void;
};

export async function runSaleMutationWithGenerationGuard<T>(
  queryClient: QueryClient,
  operation: string,
  fn: () => Promise<T>,
  options?: SaleMutationGenerationGuardOptions,
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
      throw createSaleIdentityChangedMutationError(operation);
    }
    options?.onConflictError?.(error);
    throw error;
  }

  // Sucesso de uma geração morta: a escrita já aconteceu no servidor, mas
  // nunca pode aterrissar como sucesso da sessão nova.
  if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
    throw createSaleIdentityChangedMutationError(operation);
  }

  return result;
}
