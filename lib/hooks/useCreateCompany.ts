// lib/hooks/useCreateCompany.ts — mutation de criação de empresa (M1-F
// S3-B). Chama public.create_company() SEM enviar status/created_by_
// profile_id/id/profile_id/company_id — a RPC deriva o autor de auth.uid()
// e é a autoridade real (autorização, status inicial, os 5 stages padrão).
//
// SEM retry automático: mutations.retry já é 0 no QueryClient padrão do app
// (lib/query/client.ts) — create_company não é idempotente (chamar de novo
// cria uma SEGUNDA empresa), então nenhuma opção de retry é adicionada aqui.
// Identidade vem por parâmetro — nada de AuthService neste hook.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import {
  createCompanyRpc,
  type CreateCompanyInput,
  type PlatformCompanyRow,
} from '@/lib/companies/repository';
import { isPlatformCompanyError } from '@/lib/companies/errors';

export type UseCreateCompanyOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: flag ON && platformRole === 'super_admin'.
  authorized: boolean;
};

// Mensagens estáveis dos erros LOCAIS (pré-RPC) — nunca exibidas cruas ao
// usuário (ver getCreateCompanyErrorMessage), mesmo padrão de
// REORDER_LOCAL_ERRORS (useReorderStages).
export const CREATE_COMPANY_LOCAL_ERRORS = {
  notAllowed: 'create-company-not-allowed',
  missingUser: 'create-company-missing-user',
  blankName: 'create-company-blank-name',
  staleIdentity: 'create-company-stale-identity',
} as const;

export type UseCreateCompanyResult = {
  createCompany: (input: CreateCompanyInput) => Promise<PlatformCompanyRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

// Helper PURO de mensagens amigáveis — o erro original permanece disponível
// no hook para diagnóstico; nenhuma mensagem interna do PostgreSQL, SQLSTATE,
// nome de policy ou stack trace chega à UI.
export function getCreateCompanyErrorMessage(error: unknown): string {
  const localMessage = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';

  if (localMessage === CREATE_COMPANY_LOCAL_ERRORS.notAllowed) {
    return 'Você não tem permissão para criar empresas.';
  }
  if (localMessage === CREATE_COMPANY_LOCAL_ERRORS.missingUser) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (localMessage === CREATE_COMPANY_LOCAL_ERRORS.blankName) {
    return 'Informe o nome da empresa.';
  }
  if (localMessage === CREATE_COMPANY_LOCAL_ERRORS.staleIdentity) {
    return 'A sessão mudou antes da conclusão da operação.';
  }

  // Erro do backend: SQLSTATE preservado em detail.code, nunca exibido —
  // só usado para escolher a mensagem certa.
  const code = isPlatformCompanyError(error) ? error.detail.code : undefined;
  if (code === '42501') return 'Você não tem permissão para criar empresas.';
  if (code === '23502' || code === '23514') return 'Informe o nome da empresa.';
  if (code === '22023') return 'Fuso horário inválido.';

  return 'Não foi possível criar a empresa. Tente novamente.';
}

export function useCreateCompany(options: UseCreateCompanyOptions): UseCreateCompanyResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformCompanyRow, unknown, CreateCompanyInput>({
    mutationFn: async (input) => {
      // Invariantes locais — falharam, NÃO chama o Supabase.
      if (!authorized) throw new Error(CREATE_COMPANY_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(CREATE_COMPANY_LOCAL_ERRORS.missingUser);
      if (input.name.trim() === '') throw new Error(CREATE_COMPANY_LOCAL_ERRORS.blankName);

      // Geração capturada antes da RPC: se a identidade mudar enquanto ela
      // voa, o resultado é descartado (mesmo padrão de useReorderStages).
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const created = await createCompanyRpc(input);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(CREATE_COMPANY_LOCAL_ERRORS.staleIdentity);
      }

      return created;
    },
    onSuccess: (created) => {
      if (!userId) return;
      // Atualiza SOMENTE a key da identidade atual — nenhuma empresa é
      // selecionada, nenhuma navegação, nenhuma membership presumida.
      const key = platformCompanyQueryKeys.list(userId);
      queryClient.setQueryData<PlatformCompanyRow[]>(key, (prev) =>
        prev ? [created, ...prev] : [created],
      );
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    createCompany: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
