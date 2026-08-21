// lib/hooks/useRegisterVisitResult.ts — mutation de registro de resultado
// de Visit remota (scheduled/confirmed → completed, com outcome +
// result_note atômicos) para Manager/Seller
// (COMMERCIAL-REMOTE-VISITS-B2-B). Identidade por parâmetro. SEM retry
// automático — register_visit_result usa optimistic locking via
// expectedVersion. `outcome` tipado (Database['public']['Enums']
// ['visit_outcome']) — só sold/negotiating/thinking/no_interest passam no
// compilador.
//
// CRÍTICO (EXEC §17): este hook NÃO inicia nenhum fluxo de Sale/Deal/Task
// — isso pertence à UI (B6+), decisão de produto sobre "o que fazer depois
// de registrar o resultado", nunca desta camada de infraestrutura.
//
// Política de invalidação em conflito: stale_write, visit_closed e
// visit_not_found invalidam visitQueryKeys.active; forbidden NÃO invalida.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { registerRemoteVisitResult } from '@/lib/visits/remoteMutationRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { isRemoteVisitsError, mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';

export type UseRegisterVisitResultOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type RegisterVisitResultCallInput = {
  visitId: string;
  expectedVersion: number;
  outcome: Database['public']['Enums']['visit_outcome'];
  resultNote?: string;
};

export type UseRegisterVisitResultResult = {
  registerVisitResult: (input: RegisterVisitResultCallInput) => Promise<RemoteVisitRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type RegisterVisitResultMutationResult = {
  row: RemoteVisitRow;
  capturedCompanyId: string;
};

const REGISTER_RESULT_INVALIDATE_ON_CODES = new Set([
  'remote_visits_mutation_stale_write',
  'remote_visits_mutation_visit_closed',
  'remote_visits_mutation_visit_not_found',
]);

export function useRegisterVisitResult(options: UseRegisterVisitResultOptions): UseRegisterVisitResultResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<RegisterVisitResultMutationResult, unknown, RegisterVisitResultCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const visitRemoteMode = resolveVisitRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (visitRemoteMode !== 'visit_remote_ready' || !hasIdentity) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'register_visit_result');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteVisitsMutationError({ message: 'stale_write' }, 'register_visit_result');
      }

      const capturedCompanyId = companyId as string;

      const row = await runVisitMutationWithGenerationGuard(
        queryClient,
        'register_visit_result',
        () =>
          registerRemoteVisitResult({
            visitId: input.visitId,
            expectedVersion: input.expectedVersion,
            outcome: input.outcome,
            resultNote: input.resultNote,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteVisitsError(error) && REGISTER_RESULT_INVALIDATE_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: visitQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: visitQueryKeys.active(capturedCompanyId) });
      if (row.lead_id !== null) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
      }
    },
  });

  return {
    registerVisitResult: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
