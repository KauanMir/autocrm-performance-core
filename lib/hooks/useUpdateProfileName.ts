// lib/hooks/useUpdateProfileName.ts — mutation de edição de nome (M1-F
// S5-D, RPC update_profile_name de S5-B). Único caminho: RPC
// update_profile_name() via lib/users/repository.ts — nunca UPDATE direto,
// nunca payload genérico. Mesmo molde de useCancelInvite/useReorderStages:
// identidade por parâmetro, invariantes locais antes da rede, geração de
// cache descarta resultado tardio, invalidação de list_company_users no
// sucesso.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { updateProfileNameRpc, type UpdateProfileNameResult } from '@/lib/users/repository';

export type UseUpdateProfileNameOptions = {
  userId?: string | null;
  // Resolvido pelo chamador (mesma capability que autoriza a linha/ação na
  // lista). A autoridade real é a RPC (revalida self/Super Admin/Manager
  // sobre Seller internamente).
  authorized: boolean;
};

export type UpdateProfileNameInput = {
  targetProfileId: string;
  name: string;
};

export const UPDATE_PROFILE_NAME_LOCAL_ERRORS = {
  notAllowed: 'update-profile-name-not-allowed',
  missingUser: 'update-profile-name-missing-user',
  invalidTarget: 'update-profile-name-invalid-target',
  invalidName: 'update-profile-name-invalid-name',
  staleIdentity: 'update-profile-name-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseUpdateProfileNameResult = {
  updateProfileName: (input: UpdateProfileNameInput) => Promise<UpdateProfileNameResult>;
  isPending: boolean;
  reset: () => void;
};

// Nunca texto bruto do backend/RPC. Os códigos de domínio (unauthenticated/
// forbidden/profile_not_found/user_inactive/invalid_name) chegam em
// error.message vindo direto do `raise using message = '...'` da função —
// nunca SQLSTATE cru, nunca nome de tabela/trigger, nunca stack.
export function getUpdateProfileNameErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case UPDATE_PROFILE_NAME_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para editar este usuário.';
    case UPDATE_PROFILE_NAME_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidTarget:
      return 'Usuário inválido. Atualize a lista e tente novamente.';
    case UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidName:
    case 'invalid_name':
      return 'Informe um nome válido com até 120 caracteres.';
    case UPDATE_PROFILE_NAME_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da alteração. Tente novamente.';
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case 'profile_not_found':
      return 'Usuário não encontrado ou indisponível.';
    case 'user_inactive':
      return 'Este usuário está inativo.';
    default:
      return 'Não foi possível salvar o nome. Tente novamente.';
  }
}

export function useUpdateProfileName(options: UseUpdateProfileNameOptions): UseUpdateProfileNameResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateProfileNameResult, unknown, UpdateProfileNameInput>({
    mutationFn: async ({ targetProfileId, name }) => {
      if (!authorized) throw new Error(UPDATE_PROFILE_NAME_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(UPDATE_PROFILE_NAME_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(targetProfileId)) throw new Error(UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidTarget);

      const trimmed = name.trim();
      if (trimmed === '' || trimmed.length > 120) {
        throw new Error(UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidName);
      }

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await updateProfileNameRpc(targetProfileId, trimmed);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(UPDATE_PROFILE_NAME_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
    onSuccess: () => {
      if (userId) queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
    },
  });

  return {
    updateProfileName: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
