// lib/hooks/useOffboardManager.ts — mutation de desligamento de Manager
// (M1-F S6-F, RPC offboard_manager de S6-C). Sucessor é p_successor_profile_id
// (uuid de profiles) — precisa JÁ ser Manager ativo da mesma empresa, a RPC
// nunca promove implicitamente. last_manager_requires_successor é o código
// que o chamador (OffboardManagerModal) inspeciona para manter o modal
// aberto pedindo a seleção de outro Manager já ativo.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';
import { offboardManagerRpc, type OffboardManagerResult } from '@/lib/membershipLifecycle/repository';

export type UseOffboardManagerOptions = {
  userId?: string | null;
  authorized: boolean;
};

export type OffboardManagerInput = {
  managerMembershipId: string;
  // null: sem sucessor — só válido quando existe outro Manager ativo na
  // empresa (a RPC recusa com last_manager_requires_successor quando não há).
  successorProfileId: string | null;
  note: string;
};

export const OFFBOARD_MANAGER_LOCAL_ERRORS = {
  notAllowed: 'offboard-manager-not-allowed',
  missingUser: 'offboard-manager-missing-user',
  invalidTarget: 'offboard-manager-invalid-target',
  invalidSuccessor: 'offboard-manager-invalid-successor',
  blankNote: 'offboard-manager-blank-note',
  staleIdentity: 'offboard-manager-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseOffboardManagerResult = {
  offboardManager: (input: OffboardManagerInput) => Promise<OffboardManagerResult>;
  isPending: boolean;
  reset: () => void;
};

// Códigos de domínio de offboard_manager: unauthenticated/membership_not_found/
// company_not_operational/forbidden/invalid_note/successor_invalid/
// last_manager_requires_successor.
export function getOffboardManagerErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : undefined;

  switch (message) {
    case OFFBOARD_MANAGER_LOCAL_ERRORS.notAllowed:
    case 'forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case OFFBOARD_MANAGER_LOCAL_ERRORS.missingUser:
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente.';
    case OFFBOARD_MANAGER_LOCAL_ERRORS.invalidTarget:
    case 'membership_not_found':
      return 'Vínculo empresarial não encontrado ou indisponível.';
    case OFFBOARD_MANAGER_LOCAL_ERRORS.invalidSuccessor:
    case 'successor_invalid':
      return 'Selecione um Manager já ativo da mesma empresa como sucessor.';
    case 'last_manager_requires_successor':
      return 'A empresa precisa ter outro Manager ativo. Selecione um sucessor antes de continuar.';
    case OFFBOARD_MANAGER_LOCAL_ERRORS.blankNote:
    case 'invalid_note':
      return 'Informe um motivo com 3 a 500 caracteres, sem caracteres inválidos.';
    case OFFBOARD_MANAGER_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão do desligamento. Tente novamente.';
    case 'company_not_operational':
      return 'Esta empresa não está disponível para esta ação no momento.';
    default:
      return 'Não foi possível desligar o Manager. Tente novamente.';
  }
}

export function useOffboardManager(options: UseOffboardManagerOptions): UseOffboardManagerResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<OffboardManagerResult, unknown, OffboardManagerInput>({
    mutationFn: async ({ managerMembershipId, successorProfileId, note }) => {
      if (!authorized) throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(managerMembershipId)) throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.invalidTarget);
      if (successorProfileId !== null && !UUID_PATTERN.test(successorProfileId)) {
        throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.invalidSuccessor);
      }
      if (note.trim() === '') throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.blankNote);

      const generationAtStart = getQueryCacheGeneration(queryClient);
      const result = await offboardManagerRpc(managerMembershipId, successorProfileId, note);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(OFFBOARD_MANAGER_LOCAL_ERRORS.staleIdentity);
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
    offboardManager: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
