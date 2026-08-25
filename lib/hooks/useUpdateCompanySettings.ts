// lib/hooks/useUpdateCompanySettings.ts — COMPANY-SETTINGS-R1-EXEC.
// Mutation de phone/timezone via public.update_company_settings. Mesmo
// padrão estrutural de lib/hooks/useActivateCompany.ts (erro sanitizado,
// staleness guard via getQueryCacheGeneration, sem retry automático, zero
// optimistic update).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { currentCompanyTimezoneQueryKey } from '@/lib/hooks/useCurrentCompanyTimezone';
import { updateCompanySettingsRpc, type PlatformCompanyRow } from '@/lib/companies/repository';
import { isPlatformCompanyError } from '@/lib/companies/errors';

export type UseUpdateCompanySettingsOptions = {
  userId?: string | null;
  companyId?: string | null;
  // Resolvido pelo chamador: canManageCompanySettings(currentUser) — mesmo
  // contrato de UseActivateCompanyOptions.authorized.
  authorized: boolean;
};

export type UpdateCompanySettingsInput = {
  phone: string;
  timezone: string;
};

// Mensagens estáveis dos erros LOCAIS (pré-RPC) — nunca exibidas cruas ao
// usuário, mesmo padrão de ACTIVATE_COMPANY_LOCAL_ERRORS.
export const UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS = {
  notAllowed: 'update-company-settings-not-allowed',
  missingUser: 'update-company-settings-missing-user',
  missingCompanyId: 'update-company-settings-missing-company-id',
  staleIdentity: 'update-company-settings-stale-identity',
} as const;

export type UseUpdateCompanySettingsResult = {
  updateCompanySettings: (input: UpdateCompanySettingsInput) => Promise<PlatformCompanyRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

// Helper PURO de mensagens amigáveis — nenhuma mensagem interna do
// PostgreSQL, SQLSTATE, nome de policy ou stack trace chega à UI. Mesmo
// padrão de getActivateCompanyErrorMessage.
export function getUpdateCompanySettingsErrorMessage(error: unknown): string {
  const localMessage = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';

  if (localMessage === UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.notAllowed) {
    return 'Você não tem permissão para editar esta empresa.';
  }
  if (localMessage === UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingUser) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (localMessage === UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingCompanyId) {
    return 'Empresa inválida.';
  }
  if (localMessage === UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.staleIdentity) {
    return 'A sessão mudou antes da conclusão da operação.';
  }

  const code = isPlatformCompanyError(error) ? error.detail.code : undefined;
  if (code === '42501') return 'Você não tem permissão para editar esta empresa.';
  if (code === 'P0002') return 'Empresa não encontrada.';
  if (code === 'P0001') return 'Esta empresa não está disponível para configuração no momento.';
  if (code === '22023') return 'Selecione um fuso horário válido.';

  return 'Não foi possível salvar as alterações. Tente novamente.';
}

export function useUpdateCompanySettings(options: UseUpdateCompanySettingsOptions): UseUpdateCompanySettingsResult {
  const { userId, companyId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformCompanyRow, unknown, UpdateCompanySettingsInput>({
    mutationFn: async (input) => {
      // Invariantes locais — falharam, NÃO chama o Supabase.
      if (!authorized) throw new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingUser);
      if (typeof companyId !== 'string' || companyId.trim() === '') {
        throw new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.missingCompanyId);
      }

      // Geração capturada antes da RPC: mesmo padrão de useActivateCompany —
      // se a identidade mudar enquanto ela voa, o resultado é descartado.
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const updated = await updateCompanySettingsRpc({
        companyId,
        phone: input.phone,
        timezone: input.timezone,
      });

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.staleIdentity);
      }

      return updated;
    },
    onSuccess: (updated) => {
      if (!userId || !companyId) return;

      // Atualiza a linha já em cache do PRÓPRIO hook de leitura (detail) e
      // invalida para refletir o servidor — mesmo padrão de
      // useActivateCompany.setQueryData/invalidateQueries.
      const detailKey = platformCompanyQueryKeys.detail(companyId, userId);
      queryClient.setQueryData<PlatformCompanyRow[]>(detailKey, (prev) =>
        prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: detailKey });

      // CRÍTICO (COMPANY-SETTINGS-A1-PRECHECK §12/§14, EXEC §20): mesmo dado
      // subjacente, dois OUTROS namespaces de cache separados — sem
      // invalidar os dois, a listagem de Empresas (Super Admin) e o filtro
      // de período do Pódio (Manager/Seller) ficariam com timezone/phone
      // desatualizados até o staleTime de 5min expirar.
      queryClient.invalidateQueries({ queryKey: platformCompanyQueryKeys.list(userId) });
      queryClient.invalidateQueries({ queryKey: currentCompanyTimezoneQueryKey(companyId, userId) });
    },
  });

  return {
    updateCompanySettings: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
