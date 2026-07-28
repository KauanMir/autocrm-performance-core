// lib/hooks/useReactivateMembership.ts — mutation de reativação empresarial
// (M1-F S6-F, RPC reactivate_membership de S6-B). Mesmo molde de
// useSuspendMembership; motivo é OPCIONAL aqui (contrato real: p_note text
// default null) — nunca validado quando ausente.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { reactivateMembershipRpc, type ReactivateMembershipResult } from '@/lib/membershipLifecycle/repository';

export type UseReactivateMembershipOptions = {
  userId?: string | null;
  authorized: boolean;
};

export type ReactivateMembershipInput = {
  membershipId: string;
  // null/'': omitido da chamada (motivo opcional, §ciclo de vida S6-B).
  note?: string | null;
};

export const REACTIVATE_MEMBERSHIP_LOCAL_ERRORS = {
  notAllowed: 'reactivate-membership-not-allowed',
  missingUser: 'reactivate-membership-missing-user',
  invalidTarget: 'reactivate-membership-invalid-target',
  staleIdentity: 'reactivate-membership-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseReactivateMembershipResult = {
  reactivateMembership: (input: ReactivateMembershipInput) => Promise<ReactivateMembershipResult>;
  isPending: boolean;
  reset: () => void;
};

// Códigos de domínio de reactivate_membership: unauthenticated/
// membership_not_found/company_not_operational/forbidden/invalid_note/
// seller_state_conflict/membership_lifecycle_conflict (offboarded nunca é
// reativado por este contrato).
export function getReactivateMembershipErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.notAllowed:
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da reativação. Tente novamente.';
    case 'invalid_note':
      return 'Informe um motivo com 3 a 500 caracteres, sem caracteres inválidos.';
    case 'company_not_operational':
      return 'Esta empresa não está disponível para esta ação no momento.';
    case 'seller_state_conflict':
      return 'O cadastro deste usuário está inconsistente e precisa de revisão.';
    case 'membership_lifecycle_conflict':
      return 'Este usuário foi desligado e não pode ser reativado por esta ação.';
    default:
      return 'Não foi possível reativar o usuário. Tente novamente.';
  }
}

export function useReactivateMembership(options: UseReactivateMembershipOptions): UseReactivateMembershipResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<ReactivateMembershipResult, unknown, ReactivateMembershipInput>({
    mutationFn: async ({ membershipId, note }) => {
      if (!authorized) throw new Error(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(membershipId)) throw new Error(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.invalidTarget);

      const trimmedNote = note?.trim();
      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await reactivateMembershipRpc(membershipId, trimmedNote ? trimmedNote : null);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(REACTIVATE_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
      }
      return result;
    },
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
      queryClient.invalidateQueries({ queryKey: inactiveCompanyUserQueryKeys.root(userId) });
    },
  });

  return {
    reactivateMembership: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
