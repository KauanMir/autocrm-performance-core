// lib/hooks/useActivateCompany.ts — mutation de ativação de empresa
// (PLATFORM-COMPANY-ACTIVATION-A1). Chama public.activate_company(p_company_id)
// SEM enviar status — a RPC é a autoridade real (autorização Super Admin,
// transição implantacao -> ativa, idempotência, audit_log). Mesmo padrão
// estrutural de lib/hooks/useCreateCompany.ts.
//
// SEM retry automático: mutations.retry já é 0 no QueryClient padrão do app
// (lib/query/client.ts) — ativação repetida por retry automático não seria
// destrutiva (a RPC é idempotente), mas nenhuma mutation deste projeto
// adiciona retry sem exigência, e esta não é exceção.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { activateCompanyRpc, type PlatformCompanyRow } from '@/lib/companies/repository';
import { isPlatformCompanyError } from '@/lib/companies/errors';

export type UseActivateCompanyOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: flag ON && platformRole === 'super_admin' —
  // mesmo contrato de UseCreateCompanyOptions.
  authorized: boolean;
};

// Mensagens estáveis dos erros LOCAIS (pré-RPC) — nunca exibidas cruas ao
// usuário, mesmo padrão de CREATE_COMPANY_LOCAL_ERRORS.
export const ACTIVATE_COMPANY_LOCAL_ERRORS = {
  notAllowed: 'activate-company-not-allowed',
  missingUser: 'activate-company-missing-user',
  missingCompanyId: 'activate-company-missing-company-id',
  staleIdentity: 'activate-company-stale-identity',
} as const;

export type UseActivateCompanyResult = {
  activateCompany: (companyId: string) => Promise<PlatformCompanyRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

// Helper PURO de mensagens amigáveis — nenhuma mensagem interna do
// PostgreSQL, SQLSTATE, nome de policy ou stack trace chega à UI. Mesmo
// padrão de getCreateCompanyErrorMessage.
export function getActivateCompanyErrorMessage(error: unknown): string {
  const localMessage = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';

  if (localMessage === ACTIVATE_COMPANY_LOCAL_ERRORS.notAllowed) {
    return 'Você não tem permissão para ativar empresas.';
  }
  if (localMessage === ACTIVATE_COMPANY_LOCAL_ERRORS.missingUser) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (localMessage === ACTIVATE_COMPANY_LOCAL_ERRORS.missingCompanyId) {
    return 'Empresa inválida.';
  }
  if (localMessage === ACTIVATE_COMPANY_LOCAL_ERRORS.staleIdentity) {
    return 'A sessão mudou antes da conclusão da operação.';
  }

  const code = isPlatformCompanyError(error) ? error.detail.code : undefined;
  if (code === '42501') return 'Você não tem permissão para ativar empresas.';
  if (code === 'P0002') return 'Empresa não encontrada.';
  if (code === 'P0001') return 'Esta empresa não pode ser ativada no estado atual.';

  return 'Não foi possível ativar a empresa. Tente novamente.';
}

export function useActivateCompany(options: UseActivateCompanyOptions): UseActivateCompanyResult {
  const { userId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformCompanyRow, unknown, string>({
    mutationFn: async (companyId) => {
      // Invariantes locais — falharam, NÃO chama o Supabase.
      if (!authorized) throw new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.missingUser);
      if (typeof companyId !== 'string' || companyId.trim() === '') {
        throw new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.missingCompanyId);
      }

      // Geração capturada antes da RPC: mesmo padrão de useCreateCompany —
      // se a identidade mudar enquanto ela voa, o resultado é descartado.
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const activated = await activateCompanyRpc(companyId);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(ACTIVATE_COMPANY_LOCAL_ERRORS.staleIdentity);
      }

      return activated;
    },
    onSuccess: (activated) => {
      if (!userId) return;
      // Atualiza a linha já em cache (sem inserir uma nova — diferente de
      // useCreateCompany, aqui a empresa já existe na lista) e invalida
      // para refletir o servidor. Nenhum cache paralelo é criado.
      const key = platformCompanyQueryKeys.list(userId);
      queryClient.setQueryData<PlatformCompanyRow[]>(key, (prev) =>
        prev ? prev.map((c) => (c.id === activated.id ? activated : c)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    activateCompany: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
