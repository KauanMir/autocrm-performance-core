// lib/hooks/useTransferMembership.ts — mutation de transferência empresarial
// atômica (M1-F S6-F, RPC transfer_membership de S6-D). Exclusiva de Super
// Admin. p_successor_id é PROFILE_ID (uuid de profiles) — NUNCA
// membership_id (contrato distinto de offboard_seller, relido e confirmado
// diretamente na migration/database.types.ts antes de escrever este arquivo:
// a RPC resolve a membership ativa do sucessor NA EMPRESA DE ORIGEM,
// filtrando pelo mesmo role da origem). successor_required e
// last_manager_requires_successor são códigos de domínio comuns aqui — o
// chamador (TransferMembershipModal) mantém o modal aberto nesses casos.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import type { Database } from '@/lib/supabase/database.types';
import { transferMembershipRpc, type TransferMembershipResult } from '@/lib/membershipLifecycle/repository';

export type UseTransferMembershipOptions = {
  userId?: string | null;
  authorized: boolean;
};

export type TransferMembershipInput = {
  sourceMembershipId: string;
  targetCompanyId: string;
  targetRole: Database['public']['Enums']['company_role'];
  // uuid de profiles, Seller/Manager ATIVO da empresa de ORIGEM (nunca da
  // empresa de destino) — null quando não há sucessor.
  successorProfileId: string | null;
  note: string;
};

export const TRANSFER_MEMBERSHIP_LOCAL_ERRORS = {
  notAllowed: 'transfer-membership-not-allowed',
  missingUser: 'transfer-membership-missing-user',
  invalidTarget: 'transfer-membership-invalid-target',
  invalidCompany: 'transfer-membership-invalid-company',
  invalidSuccessor: 'transfer-membership-invalid-successor',
  blankNote: 'transfer-membership-blank-note',
  staleIdentity: 'transfer-membership-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseTransferMembershipResult = {
  transferMembership: (input: TransferMembershipInput) => Promise<TransferMembershipResult>;
  isPending: boolean;
  reset: () => void;
};

// Códigos de domínio de transfer_membership: unauthenticated/
// membership_not_found/target_company_unavailable/
// same_company_transfer_forbidden/company_not_operational/forbidden/
// invalid_note/invalid_role/transfer_state_conflict/
// active_membership_conflict/seller_state_conflict/successor_invalid/
// last_manager_requires_successor/successor_required.
export function getTransferMembershipErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.notAllowed:
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidCompany:
    case 'target_company_unavailable':
      return 'Selecione uma empresa de destino válida.';
    case 'same_company_transfer_forbidden':
      return 'A empresa de destino precisa ser diferente da empresa de origem.';
    case 'invalid_role':
      return 'Selecione um papel válido para a empresa de destino.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidSuccessor:
    case 'successor_invalid':
      return 'Selecione um sucessor ativo e válido da empresa de origem, com o mesmo papel.';
    case 'successor_required':
      return 'Este usuário tem leads em aberto. Selecione outro Vendedor da empresa de origem para recebê-los.';
    case 'last_manager_requires_successor':
      return 'A empresa de origem precisa ter outro Manager ativo. Selecione um sucessor antes de continuar.';
    case 'active_membership_conflict':
      return 'Este usuário já possui um vínculo ativo na empresa de destino.';
    case 'transfer_state_conflict':
      return 'Não foi possível concluir a transferência por um conflito de estado. Recarregue e tente novamente.';
    case 'seller_state_conflict':
      return 'O cadastro deste usuário está inconsistente e precisa de revisão.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.blankNote:
    case 'invalid_note':
      return 'Informe um motivo com 3 a 500 caracteres, sem caracteres inválidos.';
    case TRANSFER_MEMBERSHIP_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da transferência. Tente novamente.';
    case 'company_not_operational':
      return 'A empresa de origem não está disponível para esta ação no momento.';
    default:
      return 'Não foi possível transferir este usuário. Tente novamente.';
  }
}

export function useTransferMembership(options: UseTransferMembershipOptions): UseTransferMembershipResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<TransferMembershipResult, unknown, TransferMembershipInput>({
    mutationFn: async ({ sourceMembershipId, targetCompanyId, targetRole, successorProfileId, note }) => {
      if (!authorized) throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(sourceMembershipId)) throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidTarget);
      if (!UUID_PATTERN.test(targetCompanyId)) throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidCompany);
      if (successorProfileId !== null && !UUID_PATTERN.test(successorProfileId)) {
        throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.invalidSuccessor);
      }
      if (note.trim() === '') throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.blankNote);

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await transferMembershipRpc(sourceMembershipId, targetCompanyId, targetRole, successorProfileId, note);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(TRANSFER_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
      }
      return result;
    },
    onSuccess: (result) => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
      queryClient.invalidateQueries({ queryKey: inactiveCompanyUserQueryKeys.root(userId) });
      if (result.leads_reassigned > 0) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.root(result.source_company_id) });
      }
    },
  });

  return {
    transferMembership: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
