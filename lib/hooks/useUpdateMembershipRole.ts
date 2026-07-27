// lib/hooks/useUpdateMembershipRole.ts — mutation de alteração de papel
// empresarial (M1-F S5-D, RPC update_membership_role de S5-C). Único
// caminho: RPC update_membership_role() via lib/users/repository.ts —
// exclusiva de Super Admin (a própria RPC recusa qualquer outro ator).
// Mesmo molde de useUpdateProfileName/useCancelInvite: identidade por
// parâmetro, invariantes locais antes da rede, geração de cache descarta
// resultado tardio, invalidação de list_company_users no sucesso.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { updateMembershipRoleRpc, type UpdateMembershipRoleResult } from '@/lib/users/repository';

export type UseUpdateMembershipRoleOptions = {
  userId?: string | null;
  // Resolvido pelo chamador (isSuperAdmin). A autoridade real é a RPC
  // (revalida platform_role='super_admin' do ator internamente).
  authorized: boolean;
};

export type UpdateMembershipRoleInput = {
  membershipId: string;
  companyId: string;
  role: 'manager' | 'seller';
};

export const UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS = {
  notAllowed: 'update-membership-role-not-allowed',
  missingUser: 'update-membership-role-missing-user',
  invalidTarget: 'update-membership-role-invalid-target',
  staleIdentity: 'update-membership-role-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseUpdateMembershipRoleResult = {
  updateMembershipRole: (input: UpdateMembershipRoleInput) => Promise<UpdateMembershipRoleResult>;
  isPending: boolean;
  reset: () => void;
};

// Nunca texto bruto do backend/RPC. Os códigos de domínio chegam em
// error.message vindo direto do `raise using message = '...'` da função
// (unauthenticated/forbidden/membership_not_found/invalid_role/
// self_role_change_forbidden/last_manager_requires_successor/
// seller_state_conflict) — nunca SQLSTATE cru, nunca nome de trigger/tabela.
export function getUpdateMembershipRoleErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para realizar esta ação.';
    case UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da alteração. Tente novamente.';
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case 'invalid_role':
      return 'Selecione um papel válido.';
    case 'self_role_change_forbidden':
      return 'Você não pode alterar o próprio cargo.';
    case 'last_manager_requires_successor':
      return 'A empresa precisa ter outro Manager antes desta alteração.';
    case 'seller_state_conflict':
      return 'O cadastro deste usuário está inconsistente e precisa de revisão.';
    default:
      return 'Não foi possível alterar o papel. Tente novamente.';
  }
}

export function useUpdateMembershipRole(options: UseUpdateMembershipRoleOptions): UseUpdateMembershipRoleResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateMembershipRoleResult, unknown, UpdateMembershipRoleInput>({
    mutationFn: async ({ membershipId, companyId, role }) => {
      if (!authorized) throw new Error(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(membershipId) || !UUID_PATTERN.test(companyId)) {
        throw new Error(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.invalidTarget);
      }

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await updateMembershipRoleRpc(membershipId, companyId, role);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(UPDATE_MEMBERSHIP_ROLE_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
    onSuccess: () => {
      if (userId) queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
    },
  });

  return {
    updateMembershipRole: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
