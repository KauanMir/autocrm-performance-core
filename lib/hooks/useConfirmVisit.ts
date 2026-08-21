// lib/hooks/useConfirmVisit.ts — mutation de confirmação de Visit remota
// (scheduled → confirmed) para Manager/Seller
// (COMMERCIAL-REMOTE-VISITS-B2-B). Identidade por parâmetro. SEM retry
// automático — confirm_visit usa optimistic locking via expectedVersion.
//
// Política de invalidação em conflito: stale_write, visit_closed,
// visit_not_found E invalid_status_transition invalidam
// visitQueryKeys.active — as quatro indicam que o status cacheado
// localmente não bate com o real (ex.: já confirmada/cancelada por outra
// sessão); forbidden NÃO invalida.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { confirmRemoteVisit } from '@/lib/visits/remoteMutationRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { isRemoteVisitsError, mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';

export type UseConfirmVisitOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type ConfirmVisitCallInput = {
  visitId: string;
  expectedVersion: number;
};

export type UseConfirmVisitResult = {
  confirmVisit: (input: ConfirmVisitCallInput) => Promise<RemoteVisitRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type ConfirmVisitMutationResult = {
  row: RemoteVisitRow;
  capturedCompanyId: string;
};

const CONFIRM_VISIT_INVALIDATE_ON_CODES = new Set([
  'remote_visits_mutation_stale_write',
  'remote_visits_mutation_visit_closed',
  'remote_visits_mutation_visit_not_found',
  'remote_visits_mutation_invalid_status_transition',
]);

export function useConfirmVisit(options: UseConfirmVisitOptions): UseConfirmVisitResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<ConfirmVisitMutationResult, unknown, ConfirmVisitCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const visitRemoteMode = resolveVisitRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (visitRemoteMode !== 'visit_remote_ready' || !hasIdentity) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'confirm_visit');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteVisitsMutationError({ message: 'stale_write' }, 'confirm_visit');
      }

      const capturedCompanyId = companyId as string;

      const row = await runVisitMutationWithGenerationGuard(
        queryClient,
        'confirm_visit',
        () =>
          confirmRemoteVisit({
            visitId: input.visitId,
            expectedVersion: input.expectedVersion,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteVisitsError(error) && CONFIRM_VISIT_INVALIDATE_ON_CODES.has(error.code)) {
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
    confirmVisit: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
