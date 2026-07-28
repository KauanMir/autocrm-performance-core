// lib/hooks/useOffboardSeller.ts — mutation de desligamento de Seller
// (M1-F S6-F, RPC offboard_seller endurecida em S6-E2). Sucessor é
// membership_id (uuid de company_memberships) — NUNCA seller_id/profile_id,
// contrato exato desde S6-E2. successor_required (novo em S6-E2) é um
// código de domínio comum, nunca tratado como falha genérica: o chamador
// (OffboardSellerModal) inspeciona a mensagem e mantém o modal aberto
// pedindo a seleção de um sucessor.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { offboardSellerRpc, type OffboardSellerResult } from '@/lib/membershipLifecycle/repository';

export type UseOffboardSellerOptions = {
  userId?: string | null;
  authorized: boolean;
};

export type OffboardSellerInput = {
  sellerMembershipId: string;
  // null: sem sucessor — só válido quando o alvo não tem leads abertos (a
  // RPC recusa com successor_required quando inválido).
  successorMembershipId: string | null;
  note: string;
};

export const OFFBOARD_SELLER_LOCAL_ERRORS = {
  notAllowed: 'offboard-seller-not-allowed',
  missingUser: 'offboard-seller-missing-user',
  invalidTarget: 'offboard-seller-invalid-target',
  invalidSuccessor: 'offboard-seller-invalid-successor',
  blankNote: 'offboard-seller-blank-note',
  staleIdentity: 'offboard-seller-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseOffboardSellerResult = {
  offboardSeller: (input: OffboardSellerInput) => Promise<OffboardSellerResult>;
  isPending: boolean;
  reset: () => void;
};

// Códigos de domínio de offboard_seller: unauthenticated/membership_not_found/
// company_not_operational/forbidden/invalid_note/seller_state_conflict/
// successor_invalid/successor_required (novo, S6-E2).
export function getOffboardSellerErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case OFFBOARD_SELLER_LOCAL_ERRORS.notAllowed:
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case OFFBOARD_SELLER_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case OFFBOARD_SELLER_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case OFFBOARD_SELLER_LOCAL_ERRORS.invalidSuccessor:
    case 'successor_invalid':
      return 'Selecione um Vendedor ativo e válido da mesma empresa como sucessor.';
    case 'successor_required':
      return 'Este Vendedor tem leads em aberto. Selecione outro Vendedor da empresa para receber esses leads.';
    case OFFBOARD_SELLER_LOCAL_ERRORS.blankNote:
    case 'invalid_note':
      return 'Informe um motivo com 3 a 500 caracteres, sem caracteres inválidos.';
    case OFFBOARD_SELLER_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão do desligamento. Tente novamente.';
    case 'company_not_operational':
      return 'Esta empresa não está disponível para esta ação no momento.';
    case 'seller_state_conflict':
      return 'O cadastro deste usuário está inconsistente e precisa de revisão.';
    default:
      return 'Não foi possível desligar o vendedor. Tente novamente.';
  }
}

export function useOffboardSeller(options: UseOffboardSellerOptions): UseOffboardSellerResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<OffboardSellerResult, unknown, OffboardSellerInput>({
    mutationFn: async ({ sellerMembershipId, successorMembershipId, note }) => {
      if (!authorized) throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(sellerMembershipId)) throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.invalidTarget);
      if (successorMembershipId !== null && !UUID_PATTERN.test(successorMembershipId)) {
        throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.invalidSuccessor);
      }
      if (note.trim() === '') throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.blankNote);

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await offboardSellerRpc(sellerMembershipId, successorMembershipId, note);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(OFFBOARD_SELLER_LOCAL_ERRORS.staleIdentity);
      }
      return result;
    },
    onSuccess: (result) => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
      queryClient.invalidateQueries({ queryKey: inactiveCompanyUserQueryKeys.root(userId) });
      // Leads só são invalidados quando algo de fato foi reatribuído — evita
      // trabalho de rede desnecessário no caminho "sem leads abertos".
      if (result.leads_reassigned > 0) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.root(result.company_id) });
      }
    },
  });

  return {
    offboardSeller: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
