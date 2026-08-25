// lib/hooks/useUpdateCompanyLogo.ts — COMPANY-IDENTITY-LOGO-R1-EXEC.
// Mutation de companies.logo_path — upload+troca ('set') e remoção
// ('remove'). Mesmo padrão estrutural de useUpdateCompanySettings (erro
// sanitizado, staleness guard via getQueryCacheGeneration, sem retry
// automático), mas orquestrando também o Storage (upload/delete de
// objeto), nunca só a RPC.
//
// Ordem do fluxo 'set' (§18/§19 do EXEC): validar arquivo (client-side,
// só UX) -> gerar novo object path -> upload -> SOMENTE após upload
// confirmado, chamar update_company_logo -> se a RPC falhar, remover o
// objeto recém-enviado (compensação, §19) e propagar o erro (logo antiga
// continua oficial) -> se a RPC suceder, tentar remover o objeto ANTIGO
// (best-effort, §20 — falha de cleanup nunca desfaz a troca já confirmada).
//
// Ordem do fluxo 'remove' (§21): RPC(null) primeiro -> só depois tentar
// remover o objeto antigo. Nunca ao contrário (nunca apaga o objeto antes
// de o banco confirmar que a empresa ficou sem logo).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { currentCompanyTimezoneQueryKey } from '@/lib/hooks/useCurrentCompanyTimezone';
import { currentCompanyIdentityQueryKey } from '@/lib/hooks/useActiveCompanyIdentity';
import { updateCompanyLogoRpc, type PlatformCompanyRow } from '@/lib/companies/repository';
import { isPlatformCompanyError } from '@/lib/companies/errors';
import {
  validateCompanyLogoFile,
  buildCompanyLogoObjectPath,
  uploadCompanyLogoObject,
  deleteCompanyLogoObject,
  type CompanyLogoMimeType,
} from '@/lib/companies/logoStorage';

export type UseUpdateCompanyLogoOptions = {
  userId?: string | null;
  companyId?: string | null;
  // Resolvido pelo chamador: canManageCompanySettings(currentUser) — mesmo
  // contrato de UseUpdateCompanySettingsOptions.authorized.
  authorized: boolean;
};

export type UpdateCompanyLogoAction =
  | { kind: 'set'; file: File; currentLogoPath: string | null }
  | { kind: 'remove'; currentLogoPath: string };

export type UpdateCompanyLogoResult = {
  company: PlatformCompanyRow;
  // true quando a troca/remoção já está CONFIRMADA no banco, mas o objeto
  // antigo não pôde ser removido fisicamente (§20) — nunca um erro para o
  // usuário, só um sinal de que um objeto órfão pode continuar existindo.
  oldObjectCleanupFailed: boolean;
};

// Mensagens estáveis dos erros LOCAIS (pré-upload/pré-RPC) — nunca exibidas
// cruas ao usuário, mesmo padrão de UPDATE_COMPANY_SETTINGS_LOCAL_ERRORS.
export const UPDATE_COMPANY_LOGO_LOCAL_ERRORS = {
  notAllowed: 'update-company-logo-not-allowed',
  missingUser: 'update-company-logo-missing-user',
  missingCompanyId: 'update-company-logo-missing-company-id',
  staleIdentity: 'update-company-logo-stale-identity',
  invalidType: 'update-company-logo-invalid-type',
  tooLarge: 'update-company-logo-too-large',
} as const;

export type UseUpdateCompanyLogoResult = {
  setLogo: (file: File, currentLogoPath: string | null) => Promise<UpdateCompanyLogoResult>;
  removeLogo: (currentLogoPath: string) => Promise<UpdateCompanyLogoResult>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

// Helper PURO de mensagens amigáveis — nenhuma mensagem interna do
// PostgreSQL/Storage chega à UI. Mesmo padrão de
// getUpdateCompanySettingsErrorMessage.
export function getUpdateCompanyLogoErrorMessage(error: unknown): string {
  const localMessage = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';

  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.notAllowed) {
    return 'Você não tem permissão para editar esta empresa.';
  }
  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingUser) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingCompanyId) {
    return 'Empresa inválida.';
  }
  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.staleIdentity) {
    return 'A sessão mudou antes da conclusão da operação.';
  }
  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.invalidType) {
    return 'Envie uma imagem PNG, JPEG ou WEBP.';
  }
  if (localMessage === UPDATE_COMPANY_LOGO_LOCAL_ERRORS.tooLarge) {
    return 'A imagem precisa ter no máximo 2 MB.';
  }

  if (isPlatformCompanyError(error) && error.code === 'platform_companies_logo_upload_failed') {
    return 'Não foi possível enviar a imagem. Tente novamente.';
  }

  const code = isPlatformCompanyError(error) ? error.detail.code : undefined;
  if (code === '42501') return 'Você não tem permissão para editar esta empresa.';
  if (code === 'P0002') return 'Empresa não encontrada.';
  if (code === 'P0001') return 'Esta empresa não está disponível para configuração no momento.';
  if (code === '22023') return 'Não foi possível salvar esta imagem. Tente enviar novamente.';

  return 'Não foi possível salvar as alterações. Tente novamente.';
}

export function useUpdateCompanyLogo(options: UseUpdateCompanyLogoOptions): UseUpdateCompanyLogoResult {
  const { userId, companyId, authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateCompanyLogoResult, unknown, UpdateCompanyLogoAction>({
    mutationFn: async (action) => {
      // Invariantes locais — falharam, NÃO chama Storage nem Supabase.
      if (!authorized) throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingUser);
      if (typeof companyId !== 'string' || companyId.trim() === '') {
        throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingCompanyId);
      }

      const generationAtStart = getQueryCacheGeneration(queryClient);

      if (action.kind === 'set') {
        const validationError = validateCompanyLogoFile(action.file);
        if (validationError === 'invalid_type') throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.invalidType);
        if (validationError === 'too_large') throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.tooLarge);

        const objectPath = buildCompanyLogoObjectPath(companyId, action.file.type as CompanyLogoMimeType);
        // C: upload real. Nenhuma UI de sucesso antes deste passo + a RPC
        // abaixo terem concluído (§18 CRÍTICO).
        await uploadCompanyLogoObject(objectPath, action.file);

        let updated: PlatformCompanyRow;
        try {
          // E: só chama a RPC depois do upload confirmado.
          updated = await updateCompanyLogoRpc({ companyId, logoPath: objectPath });
        } catch (rpcError) {
          // §19: upload novo = SUCCESS, RPC = ERROR -> remove o objeto
          // recém-enviado (best-effort) e propaga o erro da RPC. Logo
          // antiga continua sendo a oficial — nunca alterada aqui.
          await deleteCompanyLogoObject(objectPath);
          throw rpcError;
        }

        if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
          throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.staleIdentity);
        }

        // §20: RPC já confirmou a logo nova — falha ao remover a antiga
        // NUNCA desfaz a troca já confirmada, só sinaliza cleanup pendente.
        let oldObjectCleanupFailed = false;
        if (action.currentLogoPath) {
          const removed = await deleteCompanyLogoObject(action.currentLogoPath);
          oldObjectCleanupFailed = !removed;
        }

        return { company: updated, oldObjectCleanupFailed };
      }

      // action.kind === 'remove' (§21): RPC(NULL) primeiro, DELETE físico
      // do objeto antigo só depois.
      const updated = await updateCompanyLogoRpc({ companyId, logoPath: null });

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.staleIdentity);
      }

      const removed = await deleteCompanyLogoObject(action.currentLogoPath);
      return { company: updated, oldObjectCleanupFailed: !removed };
    },
    onSuccess: ({ company }) => {
      if (!userId || !companyId) return;

      const detailKey = platformCompanyQueryKeys.detail(companyId, userId);
      queryClient.setQueryData<PlatformCompanyRow[]>(detailKey, (prev) =>
        prev ? prev.map((c) => (c.id === company.id ? company : c)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: detailKey });

      // Mesmos namespaces adicionais de useUpdateCompanySettings (§37 do
      // EXEC), MAIS o namespace próprio do Rail/shell
      // (useActiveCompanyIdentity) — a nova logo precisa aparecer lá sem
      // reload. timezone nunca muda por esta mutation, mas invalidar o
      // namespace custa zero e evita qualquer suposição futura frágil.
      queryClient.invalidateQueries({ queryKey: platformCompanyQueryKeys.list(userId) });
      queryClient.invalidateQueries({ queryKey: currentCompanyTimezoneQueryKey(companyId, userId) });
      queryClient.invalidateQueries({ queryKey: currentCompanyIdentityQueryKey(companyId, userId) });
    },
  });

  return {
    setLogo: (file, currentLogoPath) => mutation.mutateAsync({ kind: 'set', file, currentLogoPath }),
    removeLogo: (currentLogoPath) => mutation.mutateAsync({ kind: 'remove', currentLogoPath }),
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
