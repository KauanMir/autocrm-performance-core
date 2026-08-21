// lib/hooks/useUpdateDeal.ts — mutation de edição de Negociação remota
// (FULL REPLACE) para Manager/Seller (COMMERCIAL-REMOTE-DEALS-B2-B).
// Identidade por parâmetro. SEM retry automático — update_deal usa
// optimistic locking via expectedVersion. SEM mutation otimista: o valor
// exibido só muda depois da resposta real.
//
// Input FULL REPLACE (contrato já congelado no repository,
// lib/deals/remoteRepository.ts): dealId/expectedVersion/vehicle/
// valueCents/discountPercent/paymentMethod/downPaymentCents/installments/
// note/assignedSellerId, nenhum campo opcional. Editar só o desconto, por
// exemplo, exige reenviar vehicle/valueCents/paymentMethod/... ATUAIS —
// este hook não busca/preenche nada por conta própria. Só válido enquanto
// a Deal está 'open' — decidido PELA RPC, nunca aqui.
//
// Política de invalidação em conflito (via
// runDealMutationWithGenerationGuard/onConflictError): stale_write,
// deal_closed e deal_not_found invalidam dealQueryKeys.active (cache pode
// estar desatualizado); forbidden/seller_required/seller_not_found/
// invalid_vehicle/invalid_value/invalid_discount/lead_archived NÃO
// invalidam (erro de payload/autorização, não de cache desatualizado).
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { updateRemoteDeal } from '@/lib/deals/remoteRepository';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { isRemoteDealsError, mapRemoteDealsMutationError } from '@/lib/deals/errors';
import { runDealMutationWithGenerationGuard } from '@/lib/deals/mutationGeneration';

export type UseUpdateDealOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UpdateDealCallInput = {
  dealId: string;
  expectedVersion: number;
  vehicle: string;
  valueCents: number;
  discountPercent: number;
  paymentMethod: RemoteDealRow['payment_method'];
  downPaymentCents: number | null;
  installments: string | null;
  note: string;
  assignedSellerId: string;
};

export type UseUpdateDealResult = {
  updateDeal: (input: UpdateDealCallInput) => Promise<RemoteDealRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type UpdateDealMutationResult = {
  row: RemoteDealRow;
  capturedCompanyId: string;
};

// update_deal: códigos de erro reais confirmados na migration #53 que
// indicam cache local possivelmente desatualizado — nunca adivinhados.
const UPDATE_DEAL_INVALIDATE_ON_CODES = new Set([
  'remote_deals_mutation_stale_write',
  'remote_deals_mutation_deal_closed',
  'remote_deals_mutation_deal_not_found',
]);

export function useUpdateDeal(options: UseUpdateDealOptions): UseUpdateDealResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateDealMutationResult, unknown, UpdateDealCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const dealRemoteMode = resolveDealRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (dealRemoteMode !== 'deal_remote_ready' || !hasIdentity) {
        throw mapRemoteDealsMutationError({ message: 'forbidden' }, 'update_deal');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteDealsMutationError({ message: 'stale_write' }, 'update_deal');
      }

      const capturedCompanyId = companyId as string;

      const row = await runDealMutationWithGenerationGuard(
        queryClient,
        'update_deal',
        () =>
          updateRemoteDeal({
            dealId: input.dealId,
            expectedVersion: input.expectedVersion,
            vehicle: input.vehicle,
            valueCents: input.valueCents,
            discountPercent: input.discountPercent,
            paymentMethod: input.paymentMethod,
            downPaymentCents: input.downPaymentCents,
            installments: input.installments,
            note: input.note,
            assignedSellerId: input.assignedSellerId,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteDealsError(error) && UPDATE_DEAL_INVALIDATE_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
      // update_deal pode ter gerado um evento "Responsável alterado" (só
      // quando assigned_seller_id de fato mudou — decidido pela RPC, não
      // aqui). lead_id é sempre NOT NULL em Deals — invalidamos a timeline
      // sempre; um refetch extra quando nada mudou é inofensivo, o client
      // nunca escreve timeline.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
    },
  });

  return {
    updateDeal: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
