// lib/hooks/useRegisterSale.ts — mutation de registro de Venda para
// Manager/Seller (COMMERCIAL-REMOTE-SALES-A2). Identidade por parâmetro.
// SEM retry automático — register_sale usa optimistic locking via
// expectedVersion (mesmo padrão de useMarkDealLost/useUpdateDeal).
//
// Único input real: dealId/expectedVersion/soldValueCents/paymentMethod —
// company_id/lead_id/assignedSellerId/soldBy NUNCA são parâmetros aqui
// (backend deriva tudo da própria Deal, migration #54, SALES-A1-PRECHECK
// §6/§15). register_sale retorna a DEAL ATUALIZADA (status='sold',
// version+1) — o caller (FlowRegistrarVenda, ramo remoto) usa essa row
// como novo currentDeal, nunca monta um status local manualmente.
//
// Política de invalidação: sempre que a mutation resolve com sucesso,
// dealQueryKeys.active (a Deal virou sold) e salesQueryKeys.active (a nova
// Sale) são invalidados; a timeline do Lead também (o RPC já escreveu
// "Venda registrada" atomicamente, dentro da própria transação — nenhum
// dual-write do frontend). Em conflito (stale_write/deal_closed/
// deal_not_found), dealQueryKeys.active também é invalidado — mesmo padrão
// de useMarkDealLost — para que o usuário nunca tente registrar a venda de
// novo sobre um snapshot desatualizado sem primeiro ver o estado real.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveSalesRemoteMode } from '@/lib/sales/remoteSalesMode';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { registerRemoteSale } from '@/lib/sales/remoteRepository';
import type { Database } from '@/lib/supabase/database.types';
import { isRemoteSalesError, mapRemoteSalesMutationError } from '@/lib/sales/errors';
import { runSaleMutationWithGenerationGuard } from '@/lib/sales/mutationGeneration';
// PODIUM-COMPETITION-R2B-B1-EXEC §33/§34 — sem isto, o Pódio/Ranking
// completo/Minha Disputa/CompTicker (R1/R2A) e os eventos de comemoração
// pessoal (R2B) nunca refletiam uma venda recém-registrada sem reload
// manual (achado do PRECHECK §27: só Deals/Sales/timeline eram
// invalidados). companySellerLeaderboardQueryKey cobre o leaderboard
// inteiro (Pódio+Ranking+Minha Disputa+CompTicker consomem o mesmo hook);
// sellerCompetitionEventsQueryKey só é relevante quando o BENEFICIÁRIO da
// venda é a própria sessão (Seller registrando a própria venda) — quando
// é o Manager registrando para outro Seller, o evento fica persistido no
// servidor e esse Seller o vê no próprio próximo load (§34 do EXEC: "não
// precisa buscar eventos pessoais do Seller na sessão Manager").
import { companySellerLeaderboardQueryPrefix } from '@/lib/hooks/useCompanySellerLeaderboard';
import { sellerCompetitionEventsQueryKey } from '@/lib/hooks/useSellerCompetitionEvents';

type RemoteDealRow = Database['public']['Tables']['deals']['Row'];
type DealPaymentMethod = Database['public']['Enums']['deal_payment_method'];

export type UseRegisterSaleOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type RegisterSaleCallInput = {
  dealId: string;
  expectedVersion: number;
  soldValueCents: number;
  paymentMethod: DealPaymentMethod;
};

export type UseRegisterSaleResult = {
  registerSale: (input: RegisterSaleCallInput) => Promise<RemoteDealRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type RegisterSaleMutationResult = {
  row: RemoteDealRow;
  capturedCompanyId: string;
};

const REGISTER_SALE_INVALIDATE_DEALS_ON_CODES = new Set([
  'remote_sales_mutation_stale_write',
  'remote_sales_mutation_deal_closed',
  'remote_sales_mutation_deal_not_found',
]);

export function useRegisterSale(options: UseRegisterSaleOptions): UseRegisterSaleResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<RegisterSaleMutationResult, unknown, RegisterSaleCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const saleRemoteMode = resolveSalesRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (saleRemoteMode !== 'sale_remote_ready' || !hasIdentity) {
        throw mapRemoteSalesMutationError({ message: 'forbidden' }, 'register_sale');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteSalesMutationError({ message: 'stale_write' }, 'register_sale');
      }

      const capturedCompanyId = companyId as string;

      const row = await runSaleMutationWithGenerationGuard(
        queryClient,
        'register_sale',
        () =>
          registerRemoteSale({
            dealId: input.dealId,
            expectedVersion: input.expectedVersion,
            soldValueCents: input.soldValueCents,
            paymentMethod: input.paymentMethod,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteSalesError(error) && REGISTER_SALE_INVALIDATE_DEALS_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: dealQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: salesQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
      // §33/§34 do EXEC — Pódio/Ranking completo/Minha Disputa/CompTicker
      // (mesmo hook de leaderboard) e eventos de comemoração pessoal nunca
      // refletiam uma venda recém-registrada sem reload manual antes desta
      // etapa. sellerCompetitionEventsQueryKey só é populada de fato
      // quando a própria sessão é Seller (gate do hook) — invalidar
      // incondicionalmente aqui é inofensivo quando não havia nada
      // cacheado (Manager registrando para outro Seller).
      queryClient.invalidateQueries({ queryKey: companySellerLeaderboardQueryPrefix(capturedCompanyId) });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: sellerCompetitionEventsQueryKey(capturedCompanyId, userId) });
      }
    },
  });

  return {
    registerSale: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
