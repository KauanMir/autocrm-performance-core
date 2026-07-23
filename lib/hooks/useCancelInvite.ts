// lib/hooks/useCancelInvite.ts — mutation de cancelamento de convite (M1-F
// S4-F3). Único caminho: RPC cancel_invite() via lib/invites/repository.ts
// (cancelInviteRpc) — nunca UPDATE direto, nunca service_role, nunca Route
// Handler novo (a RPC já é EXECUTE-concedida a authenticated e revalida
// tudo internamente, ver design §10). Mesmo molde de useCreateInvite/
// useResendInvite: identidade por parâmetro, invariantes locais antes da
// rede, geração de cache descarta resultado tardio.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { cancelInviteRpc, type CancelInviteResult } from '@/lib/invites/repository';

export type UseCancelInviteOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: canManageInvites(currentUser). A autoridade
  // real é a RPC (revalida auth.uid()/ator/empresa/invited_by_profile_id).
  authorized: boolean;
};

export const CANCEL_INVITE_LOCAL_ERRORS = {
  notAllowed: 'cancel-invite-not-allowed',
  missingUser: 'cancel-invite-missing-user',
  invalidId: 'cancel-invite-invalid-id',
  staleIdentity: 'cancel-invite-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseCancelInviteResult = {
  cancelInvite: (inviteId: string) => Promise<CancelInviteResult>;
  isPending: boolean;
  reset: () => void;
};

// Mesmo padrão de getCreateInviteErrorMessage/getResendInviteErrorMessage:
// nunca texto bruto do backend/RPC. 'cross-tenant' (tentar cancelar convite
// de outra empresa/outro convidador) colapsa em invite_not_found — a RPC
// nunca revela que o id existe em outro contexto (mesma defesa de
// resend_invite/cancel_invite, ver migration).
export function getCancelInviteErrorMessage(value: unknown): string {
  const localMessage = value instanceof Error ? value.message : undefined;

  switch (localMessage) {
    case CANCEL_INVITE_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para cancelar este convite.';
    case CANCEL_INVITE_LOCAL_ERRORS.missingUser:
      return 'Sua sessão expirou. Faça login novamente.';
    case CANCEL_INVITE_LOCAL_ERRORS.invalidId:
      return 'Convite inválido. Atualize a lista e tente novamente.';
    case CANCEL_INVITE_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão do cancelamento. Tente novamente.';
    default:
      break;
  }

  const result = value as { outcome?: string; code?: string } | null | undefined;
  if (result?.outcome === 'domain_error') {
    switch (result.code) {
      case 'invite_not_found':
        return 'Este convite não está mais disponível para cancelamento.';
      case 'invite_not_actionable':
        return 'Este convite não pode mais ser cancelado no estado atual.';
      default:
        return 'Não foi possível cancelar o convite. Tente novamente.';
    }
  }
  if (result?.outcome === 'error') {
    return 'Não foi possível cancelar o convite. Verifique sua conexão e tente novamente.';
  }

  return 'Não foi possível cancelar o convite. Tente novamente.';
}

export function useCancelInvite(options: UseCancelInviteOptions): UseCancelInviteResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CancelInviteResult, unknown, string>({
    mutationFn: async (inviteId) => {
      if (!authorized) throw new Error(CANCEL_INVITE_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(CANCEL_INVITE_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(inviteId)) throw new Error(CANCEL_INVITE_LOCAL_ERRORS.invalidId);

      const generationAtStart = getQueryCacheGeneration(queryClient);

      const result = await cancelInviteRpc(inviteId);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(CANCEL_INVITE_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
  });

  return {
    cancelInvite: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
