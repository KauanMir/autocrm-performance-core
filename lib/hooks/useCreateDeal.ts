// lib/hooks/useCreateDeal.ts — mutation de criação de Negociação remota
// para Manager/Seller (COMMERCIAL-REMOTE-DEALS-B2-B). Identidade por
// parâmetro (mesmo padrão de useCreateVisit/useCreateTask — nunca importa
// AuthService). SEM retry automático (create_deal não é idempotente —
// reenviar cria uma SEGUNDA Deal). SEM mutation otimista, SEM
// setQueryData: sucesso invalida dealQueryKeys.active(companyId) e deixa o
// refetch decidir a nova lista.
//
// Input discriminado por actorRole (mesmo padrão de CreateVisitCallInput):
// a variante 'seller' estruturalmente NÃO TEM campo assignedSellerId —
// nenhum caller Seller consegue compilar um envio de responsável
// arbitrário (o backend sempre autoatribui). Manager pode OMITIR
// assignedSellerId (o backend tenta o Seller do Lead, se houver e ativo).
// input.actorRole é conferido em runtime contra o membershipRole real do
// hook — nenhum caller consegue alegar um actorRole diferente da própria
// identidade.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { createRemoteDeal } from '@/lib/deals/remoteRepository';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { mapRemoteDealsMutationError } from '@/lib/deals/errors';
import { runDealMutationWithGenerationGuard } from '@/lib/deals/mutationGeneration';

export type UseCreateDealOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

type CreateDealCommonFields = {
  leadId: string;
  vehicle: string;
  valueCents: number;
  discountPercent: number;
  paymentMethod: RemoteDealRow['payment_method'];
  downPaymentCents?: number | null;
  installments?: string | null;
  note?: string;
};

export type CreateDealCallInput =
  | (CreateDealCommonFields & { actorRole: 'manager'; assignedSellerId?: string | null })
  | (CreateDealCommonFields & { actorRole: 'seller' });

export type UseCreateDealResult = {
  createDeal: (input: CreateDealCallInput) => Promise<RemoteDealRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CreateDealMutationResult = {
  row: RemoteDealRow;
  capturedCompanyId: string;
};

export function useCreateDeal(options: UseCreateDealOptions): UseCreateDealResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateDealMutationResult, unknown, CreateDealCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const dealRemoteMode = resolveDealRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      // Mode inválido OU identidade incompleta: falha fechada, nenhuma RPC.
      if (dealRemoteMode !== 'deal_remote_ready' || !hasIdentity) {
        throw mapRemoteDealsMutationError({ message: 'forbidden' }, 'create_deal');
      }

      // Consistência de role: input.actorRole PRECISA corresponder ao
      // membershipRole real do hook — nenhum caller consegue contornar as
      // regras de seller alegando um actorRole diferente da própria
      // identidade.
      if (input.actorRole !== membershipRole) {
        throw mapRemoteDealsMutationError({ message: 'forbidden' }, 'create_deal');
      }

      const capturedCompanyId = companyId as string;

      const row = await runDealMutationWithGenerationGuard(queryClient, 'create_deal', () =>
        createRemoteDeal(
          input.actorRole === 'manager'
            ? {
                leadId: input.leadId,
                vehicle: input.vehicle,
                valueCents: input.valueCents,
                discountPercent: input.discountPercent,
                paymentMethod: input.paymentMethod,
                downPaymentCents: input.downPaymentCents,
                installments: input.installments,
                note: input.note,
                assignedSellerId: input.assignedSellerId,
              }
            : {
                leadId: input.leadId,
                vehicle: input.vehicle,
                valueCents: input.valueCents,
                discountPercent: input.discountPercent,
                paymentMethod: input.paymentMethod,
                downPaymentCents: input.downPaymentCents,
                installments: input.installments,
                note: input.note,
                // assignedSellerId OMITIDO de propósito — Seller sempre
                // autoatribuído pelo backend (create_deal, actor_kind
                // 'seller').
              },
        ),
      );
      // create_deal não tem nenhum código de erro que justifique invalidar
      // dealQueryKeys.active em conflito (sem p_expected_version — não
      // existe stale_write para create; forbidden/seller_required/
      // seller_not_found/lead_not_found/lead_archived/invalid_vehicle/
      // invalid_value/invalid_discount são todos erros de
      // payload/autorização) — por isso nenhum onConflictError é passado
      // aqui (mesmo raciocínio de useCreateVisit/useCreateTask).

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
      // RPC já escreveu o evento "Negociação criada" atomicamente
      // (record_lead_timeline_event, dentro da própria transação) — lead_id
      // é sempre NOT NULL em Deals (diferente de Visits), então a
      // invalidação da timeline é incondicional, sem checar row.lead_id.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
    },
  });

  return {
    createDeal: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
