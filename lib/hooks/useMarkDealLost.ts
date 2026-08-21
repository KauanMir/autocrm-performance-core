// lib/hooks/useMarkDealLost.ts — mutation de encerramento de Negociação
// como perdida (open → lost) para Manager/Seller
// (COMMERCIAL-REMOTE-DEALS-B2-B). Identidade por parâmetro. SEM retry
// automático — mark_deal_lost usa optimistic locking via expectedVersion.
// Nenhum DELETE — mark_deal_lost é não-destrutivo (mesmo padrão de
// archive_lead/complete_task/cancel_visit). Sem lostReason, sem note
// obrigatório, sem aprovação de gestor — encerramento simples, por design
// do pivot de produto. Nenhum caminho para 'sold' existe neste hook (Sale
// será autoridade exclusiva da conversão, fora deste lote).
//
// Política de invalidação em conflito: stale_write, deal_closed e
// deal_not_found invalidam dealQueryKeys.active; forbidden NÃO invalida.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { markRemoteDealLost } from '@/lib/deals/remoteRepository';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { isRemoteDealsError, mapRemoteDealsMutationError } from '@/lib/deals/errors';
import { runDealMutationWithGenerationGuard } from '@/lib/deals/mutationGeneration';

export type UseMarkDealLostOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type MarkDealLostCallInput = {
  dealId: string;
  expectedVersion: number;
};

export type UseMarkDealLostResult = {
  markDealLost: (input: MarkDealLostCallInput) => Promise<RemoteDealRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type MarkDealLostMutationResult = {
  row: RemoteDealRow;
  capturedCompanyId: string;
};

const MARK_DEAL_LOST_INVALIDATE_ON_CODES = new Set([
  'remote_deals_mutation_stale_write',
  'remote_deals_mutation_deal_closed',
  'remote_deals_mutation_deal_not_found',
]);

export function useMarkDealLost(options: UseMarkDealLostOptions): UseMarkDealLostResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<MarkDealLostMutationResult, unknown, MarkDealLostCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const dealRemoteMode = resolveDealRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (dealRemoteMode !== 'deal_remote_ready' || !hasIdentity) {
        throw mapRemoteDealsMutationError({ message: 'forbidden' }, 'mark_deal_lost');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteDealsMutationError({ message: 'stale_write' }, 'mark_deal_lost');
      }

      const capturedCompanyId = companyId as string;

      const row = await runDealMutationWithGenerationGuard(
        queryClient,
        'mark_deal_lost',
        () =>
          markRemoteDealLost({
            dealId: input.dealId,
            expectedVersion: input.expectedVersion,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteDealsError(error) && MARK_DEAL_LOST_INVALIDATE_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
    },
  });

  return {
    markDealLost: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
