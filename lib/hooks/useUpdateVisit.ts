// lib/hooks/useUpdateVisit.ts — mutation de edição de Visit remota (FULL
// REPLACE, cobre reagendamento) para Manager/Seller
// (COMMERCIAL-REMOTE-VISITS-B2-B). Identidade por parâmetro. SEM retry
// automático — update_visit usa optimistic locking via expectedVersion.
// SEM mutation otimista: o valor exibido só muda depois da resposta real.
//
// Input FULL REPLACE (contrato já congelado no repository,
// lib/visits/remoteMutationRepository.ts): visitId/expectedVersion/
// scheduledAt/vehicles/note/assignedSellerId, nenhum campo opcional.
// Reagendar, por exemplo, exige reenviar vehicles/note/assignedSellerId
// ATUAIS — este hook não busca/preenche nada por conta própria. O reset
// confirmed→scheduled quando scheduled_at muda é decidido PELA RPC, nunca
// aqui — nenhum cálculo de status no client.
//
// Política de invalidação em conflito (via
// runVisitMutationWithGenerationGuard/onConflictError): stale_write,
// visit_closed e visit_not_found invalidam visitQueryKeys.active (cache
// pode estar desatualizado); forbidden/seller_required/seller_not_found/
// invalid_vehicles NÃO invalidam (erro de payload/autorização, não de
// cache desatualizado).
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { updateRemoteVisit } from '@/lib/visits/remoteMutationRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { isRemoteVisitsError, mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';

export type UseUpdateVisitOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UpdateVisitCallInput = {
  visitId: string;
  expectedVersion: number;
  scheduledAt: string;
  vehicles: readonly string[];
  note: string;
  assignedSellerId: string;
};

export type UseUpdateVisitResult = {
  updateVisit: (input: UpdateVisitCallInput) => Promise<RemoteVisitRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type UpdateVisitMutationResult = {
  row: RemoteVisitRow;
  capturedCompanyId: string;
};

// update_visit: códigos de erro reais confirmados na migration #52 que
// indicam cache local possivelmente desatualizado — nunca adivinhados.
const UPDATE_VISIT_INVALIDATE_ON_CODES = new Set([
  'remote_visits_mutation_stale_write',
  'remote_visits_mutation_visit_closed',
  'remote_visits_mutation_visit_not_found',
]);

export function useUpdateVisit(options: UseUpdateVisitOptions): UseUpdateVisitResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateVisitMutationResult, unknown, UpdateVisitCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const visitRemoteMode = resolveVisitRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (visitRemoteMode !== 'visit_remote_ready' || !hasIdentity) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'update_visit');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteVisitsMutationError({ message: 'stale_write' }, 'update_visit');
      }

      const capturedCompanyId = companyId as string;

      const row = await runVisitMutationWithGenerationGuard(
        queryClient,
        'update_visit',
        () =>
          updateRemoteVisit({
            visitId: input.visitId,
            expectedVersion: input.expectedVersion,
            scheduledAt: input.scheduledAt,
            vehicles: input.vehicles,
            note: input.note,
            assignedSellerId: input.assignedSellerId,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteVisitsError(error) && UPDATE_VISIT_INVALIDATE_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: visitQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: visitQueryKeys.active(capturedCompanyId) });
      // update_visit pode ter gerado um evento "Visita remarcada" (só
      // quando scheduled_at de fato mudou — decidido pela RPC, não aqui).
      // Invalidamos a timeline sempre que há Lead — um refetch extra
      // quando nada mudou é inofensivo; o client nunca escreve timeline.
      if (row.lead_id !== null) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
      }
    },
  });

  return {
    updateVisit: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
