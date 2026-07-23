// lib/hooks/useResendInvite.ts — mutation de reenvio de convite (M1-F
// S4-F3). Mesmo molde de useCreateInvite.ts: identidade vem por parâmetro
// (nada de AuthService aqui), invariantes locais lançam ANTES de qualquer
// rede, geração de cache capturada antes do fetch e reconferida depois
// (resultado tardio após troca de identidade é descartado).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { resendInviteRequest, type ResendInviteResult } from '@/lib/invites/resendInviteRequest';

export type UseResendInviteOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: canManageInvites(currentUser). Este hook não
  // decide autorização — a autoridade real é o Route Handler + a RPC
  // resend_invite (revalida ator/empresa/convite específico).
  authorized: boolean;
  getAccessToken: () => Promise<string | null>;
};

export const RESEND_INVITE_LOCAL_ERRORS = {
  notAllowed: 'resend-invite-not-allowed',
  missingUser: 'resend-invite-missing-user',
  invalidId: 'resend-invite-invalid-id',
  missingSession: 'resend-invite-missing-session',
  staleIdentity: 'resend-invite-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type UseResendInviteResult = {
  resendInvite: (inviteId: string, signal?: AbortSignal) => Promise<ResendInviteResult>;
  isPending: boolean;
  reset: () => void;
};

// Mesmo padrão de getCreateInviteErrorMessage (useCreateInvite.ts): nunca
// texto bruto do backend, aceita tanto o erro LOCAL (mutation.error, lançado
// antes da rede) quanto o ResendInviteResult resolvido (outcome !== 'ok').
export function getResendInviteErrorMessage(value: unknown): string {
  const localMessage = value instanceof Error ? value.message : undefined;

  switch (localMessage) {
    case RESEND_INVITE_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para reenviar este convite.';
    case RESEND_INVITE_LOCAL_ERRORS.missingUser:
    case RESEND_INVITE_LOCAL_ERRORS.missingSession:
      return 'Sua sessão expirou. Faça login novamente.';
    case RESEND_INVITE_LOCAL_ERRORS.invalidId:
      return 'Convite inválido. Atualize a lista e tente novamente.';
    case RESEND_INVITE_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão do reenvio. Tente novamente.';
    default:
      break;
  }

  const result = value as { outcome?: string; code?: string } | null | undefined;
  if (result?.outcome === 'rate_limited') {
    return 'Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente.';
  }
  if (result?.outcome === 'domain_error') {
    switch (result.code) {
      case 'invite_not_found':
        return 'Este convite não está mais disponível.';
      case 'invite_not_actionable':
        return 'Este convite não pode mais ser reenviado no estado atual.';
      case 'duplicate_pending':
        return 'Já existe outro convite pendente para este e-mail.';
      case 'token_conflict':
        return 'Não foi possível gerar o novo convite. Tente novamente.';
      case 'company_not_operational':
        return 'Esta empresa não está disponível para reenvios no momento.';
      case 'forbidden':
      case 'invalid_origin':
        return 'Você não tem permissão para reenviar este convite.';
      case 'unauthenticated':
        return 'Sua sessão expirou. Faça login novamente.';
      case 'delivery_failed':
        return 'O convite foi renovado, mas o e-mail não pôde ser enviado agora.';
      case 'auth_unavailable':
        return 'Serviço de autenticação indisponível no momento. Tente novamente em instantes.';
      case 'delivery_finalize_failed':
        return 'O convite foi renovado, mas houve uma falha ao confirmar o envio.';
      default:
        return 'Não foi possível reenviar o convite. Tente novamente.';
    }
  }
  if (result?.outcome === 'error') {
    return 'Não foi possível reenviar o convite. Verifique sua conexão e tente novamente.';
  }

  return 'Não foi possível reenviar o convite. Tente novamente.';
}

export function useResendInvite(options: UseResendInviteOptions): UseResendInviteResult {
  const { userId, authorized, getAccessToken } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<ResendInviteResult, unknown, { inviteId: string; signal?: AbortSignal }>({
    mutationFn: async ({ inviteId, signal }) => {
      if (!authorized) throw new Error(RESEND_INVITE_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(RESEND_INVITE_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(inviteId)) throw new Error(RESEND_INVITE_LOCAL_ERRORS.invalidId);

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(RESEND_INVITE_LOCAL_ERRORS.missingSession);

      const generationAtStart = getQueryCacheGeneration(queryClient);

      const result = await resendInviteRequest(inviteId, accessToken, signal);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(RESEND_INVITE_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
  });

  return {
    resendInvite: (inviteId, signal) => mutation.mutateAsync({ inviteId, signal }),
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
