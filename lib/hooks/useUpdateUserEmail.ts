// lib/hooks/useUpdateUserEmail.ts — mutation de alteração administrativa de
// e-mail (M1-F S5-E1-B). Único caminho: POST /api/admin/users/[profileId]/
// email via lib/users/emailRequest.ts — nunca supabase.auth.admin.* no
// browser, nunca payload com companyId/role/platformRole/name/status/
// membershipId. Mesmo molde de useCreateInvite (identidade por parâmetro,
// invariantes locais antes da rede, token buscado no momento do submit,
// geração de cache descarta resultado tardio) combinado com o padrão de
// invalidação de useUpdateProfileName/useUpdateMembershipRole (só
// list_company_users, nunca convites).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';
import { updateUserEmailRequest, type UpdateUserEmailResult } from '@/lib/users/emailRequest';

export type UseUpdateUserEmailOptions = {
  userId?: string | null;
  // Resolvido pelo chamador (canEditEmail — Super Admin, nunca o próprio
  // profile). A autoridade real é o Route Handler (revalida Super
  // Admin/self/outro Super Admin internamente).
  authorized: boolean;
  // Resolvido pelo chamador (nunca lido aqui via AuthService) — token
  // FRESCO buscado no momento do submit, nunca cacheado de um render
  // anterior. null quando não há sessão válida.
  getAccessToken: () => Promise<string | null>;
};

export type UpdateUserEmailInput = {
  profileId: string;
  email: string;
  signal?: AbortSignal;
};

export const UPDATE_USER_EMAIL_LOCAL_ERRORS = {
  notAllowed: 'update-user-email-not-allowed',
  missingUser: 'update-user-email-missing-user',
  invalidTarget: 'update-user-email-invalid-target',
  invalidEmail: 'update-user-email-invalid-email',
  missingSession: 'update-user-email-missing-session',
  staleIdentity: 'update-user-email-stale-identity',
} as const;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

export type UseUpdateUserEmailResult = {
  updateUserEmail: (input: UpdateUserEmailInput) => Promise<UpdateUserEmailResult>;
  isPending: boolean;
  reset: () => void;
};

// Nunca texto bruto do backend. Os códigos de domínio chegam via
// {outcome:'domain_error', code} (lib/users/emailRequest.ts nunca lança para
// esse caso) — nunca revela quem já usa o e-mail, nunca SQLSTATE, nunca
// detalhe de compensação interna.
export function getUpdateUserEmailErrorMessage(value: unknown): string {
  const localMessage = value instanceof Error ? value.message : undefined;

  switch (localMessage) {
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para alterar este e-mail.';
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.missingUser:
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.missingSession:
      return 'Sua sessão expirou. Entre novamente.';
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidTarget:
      return 'Usuário inválido. Atualize a lista e tente novamente.';
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail:
      return 'Informe um endereço de e-mail válido.';
    case UPDATE_USER_EMAIL_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão da alteração. Tente novamente.';
    default:
      break;
  }

  const result = value as { outcome?: string; code?: string } | null | undefined;
  if (result?.outcome === 'domain_error') {
    switch (result.code) {
      case 'unauthenticated':
        return 'Sua sessão expirou. Entre novamente.';
      case 'forbidden':
        return 'Você não tem permissão para alterar este e-mail.';
      case 'invalid_email':
        return 'Informe um endereço de e-mail válido.';
      case 'user_not_found':
        return 'Usuário não encontrado ou indisponível.';
      case 'user_inactive':
        return 'Este usuário está inativo.';
      case 'email_already_in_use':
        return 'Este e-mail não está disponível.';
      case 'user_email_state_conflict':
        return 'Os dados de e-mail deste usuário precisam de revisão antes da alteração.';
      case 'email_update_failed':
        return 'Não foi possível concluir a alteração. Nenhuma mudança foi mantida.';
      case 'email_compensation_failed':
        return 'A alteração não pôde ser concluída e precisa de revisão administrativa.';
      default:
        return 'Não foi possível concluir a alteração. Tente novamente.';
    }
  }
  if (result?.outcome === 'error') {
    return 'Não foi possível concluir a alteração. Verifique sua conexão e tente novamente.';
  }

  return 'Não foi possível concluir a alteração. Tente novamente.';
}

export function useUpdateUserEmail(options: UseUpdateUserEmailOptions): UseUpdateUserEmailResult {
  const { userId, authorized, getAccessToken } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateUserEmailResult, unknown, UpdateUserEmailInput>({
    mutationFn: async ({ profileId, email, signal }) => {
      if (!authorized) throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.missingUser);
      if (!UUID_PATTERN.test(profileId)) throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidTarget);

      if (CONTROL_CHAR_PATTERN.test(email)) throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail);
      const trimmed = email.trim();
      if (trimmed === '' || trimmed.length > MAX_EMAIL_LENGTH || /\s/.test(trimmed)) {
        throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail);
      }
      const normalized = trimmed.toLowerCase();
      if (!EMAIL_PATTERN.test(normalized)) {
        throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail);
      }

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.missingSession);

      // Geração capturada IMEDIATAMENTE antes do fetch: se a identidade
      // mudar enquanto ele voa, o resultado é descartado.
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const result = await updateUserEmailRequest(profileId, normalized, accessToken, signal);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(UPDATE_USER_EMAIL_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
    onSuccess: (result) => {
      // Só invalida em sucesso REAL (outcome 'ok') — domain_error/error
      // resolvem sem lançar, mas não mudaram nada no servidor.
      if (userId && result.outcome === 'ok') {
        queryClient.invalidateQueries({ queryKey: companyUserQueryKeys.root(userId) });
      }
    },
  });

  return {
    updateUserEmail: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
