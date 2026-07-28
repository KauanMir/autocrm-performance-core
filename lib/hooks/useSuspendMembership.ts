// lib/hooks/useSuspendMembership.ts — mutation de suspensão empresarial
// (M1-F S6-F, RPC suspend_membership de S6-B). Único caminho: RPC via
// lib/membershipLifecycle/repository.ts — exclusiva de Super Admin (qualquer
// empresa) ou Manager (só Seller da própria empresa), nunca Seller. Mesmo
// molde de useUpdateMembershipRole: identidade por parâmetro, invariantes
// locais antes da rede, geração de cache descarta resultado tardio,
// invalidação de usuários ativos E inativos no sucesso (a linha migra de uma
// lista para a outra).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { suspendMembershipRpc, type SuspendMembershipResult } from '@/lib/membershipLifecycle/repository';

export type UseSuspendMembershipOptions = {
  userId?: string | null;
  // Resolvido pelo chamador via membershipLifecycleCapabilities(). A
  // autoridade real é a RPC.
  authorized: boolean;
};

export type SuspendMembershipInput = {
  membershipId: string;
  note: string;
};

export const SUSPEND_MEMBERSHIP_LOCAL_ERRORS = {
  notAllowed: 'suspend-membership-not-allowed',
  missingUser: 'suspend-membership-missing-user',
  invalidTarget: 'suspend-membership-invalid-target',
  blankNote: 'suspend-membership-blank-note',
  staleIdentity: 'suspend-membership-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseSuspendMembershipResult = {
  suspendMembership: (input: SuspendMembershipInput) => Promise<SuspendMembershipResult>;
  isPending: boolean;
  reset: () => void;
};

// Nunca texto bruto do backend. Códigos de domínio chegam em error.message
// vindo direto do `raise using message = '...'` de suspend_membership
// (unauthenticated/membership_not_found/company_not_operational/forbidden/
// invalid_note/seller_state_conflict/last_manager_requires_successor).
export function getSuspendMembershipErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case SUSPEND_MEMBERSHIP_LOCAL_ERRORS.notAllowed:
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case SUSPEND_MEMBERSHIP_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case SUSPEND_MEMBERSHIP_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case SUSPEND_MEMBERSHIP_LOCAL_ERRORS.blankNote:
    case 'invalid_note':
      return 'Informe um motivo com 3 a 500 caracteres, sem caracteres inválidos.';
    case SUSPEND_MEMBERSHIP_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da suspensão. Tente novamente.';
    case 'company_not_operational':
      return 'Esta empresa não está disponível para esta ação no momento.';
    case 'seller_state_conflict':
      return 'O cadastro deste usuário está inconsistente e precisa de revisão.';
    case 'last_manager_requires_successor':
      return 'A empresa precisa ter outro Manager ativo antes desta suspensão.';
    default:
      return 'Não foi possível suspender o usuário. Tente novamente.';
  }
}

export function useSuspendMembership(options: UseSuspendMembershipOptions): UseSuspendMembershipResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<SuspendMembershipResult, unknown, SuspendMembershipInput>({
    mutationFn: async ({ membershipId, note }) => {
      if (!authorized) throw new Error(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(membershipId)) throw new Error(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.invalidTarget);
      if (note.trim() === '') throw new Error(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.blankNote);

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await suspendMembershipRpc(membershipId, note);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(SUSPEND_MEMBERSHIP_LOCAL_ERRORS.staleIdentity);
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
    suspendMembership: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
