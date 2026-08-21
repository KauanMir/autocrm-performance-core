// lib/hooks/useCancelVisit.ts — mutation de cancelamento de Visit remota
// (scheduled/confirmed → canceled) para Manager/Seller
// (COMMERCIAL-REMOTE-VISITS-B2-B). Identidade por parâmetro. SEM retry
// automático — cancel_visit usa optimistic locking via expectedVersion.
// Nenhum DELETE — cancel_visit é não-destrutivo (mesmo padrão de
// archive_lead/complete_task).
//
// Política de invalidação em conflito: stale_write, visit_closed e
// visit_not_found invalidam visitQueryKeys.active; forbidden NÃO invalida.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { cancelRemoteVisit } from '@/lib/visits/remoteMutationRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { isRemoteVisitsError, mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';

export type UseCancelVisitOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type CancelVisitCallInput = {
  visitId: string;
  expectedVersion: number;
};

export type UseCancelVisitResult = {
  cancelVisit: (input: CancelVisitCallInput) => Promise<RemoteVisitRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CancelVisitMutationResult = {
  row: RemoteVisitRow;
  capturedCompanyId: string;
};

const CANCEL_VISIT_INVALIDATE_ON_CODES = new Set([
  'remote_visits_mutation_stale_write',
  'remote_visits_mutation_visit_closed',
  'remote_visits_mutation_visit_not_found',
]);

export function useCancelVisit(options: UseCancelVisitOptions): UseCancelVisitResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CancelVisitMutationResult, unknown, CancelVisitCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const visitRemoteMode = resolveVisitRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (visitRemoteMode !== 'visit_remote_ready' || !hasIdentity) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'cancel_visit');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteVisitsMutationError({ message: 'stale_write' }, 'cancel_visit');
      }

      const capturedCompanyId = companyId as string;

      const row = await runVisitMutationWithGenerationGuard(
        queryClient,
        'cancel_visit',
        () =>
          cancelRemoteVisit({
            visitId: input.visitId,
            expectedVersion: input.expectedVersion,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteVisitsError(error) && CANCEL_VISIT_INVALIDATE_ON_CODES.has(error.code)) {
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
    cancelVisit: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
