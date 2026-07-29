// lib/hooks/useArchivePlatformLead.ts — mutation de arquivamento pela
// superfície platform do Super Admin (M1-F S8-C2-D2). Chama archive_lead
// com p_company_id SEMPRE explícito. Idempotência é garantida pelo backend
// (estado já arquivado retorna a linha sem novo bump de version) — a UI não
// deve, ainda assim, disparar chamadas repetidas voluntariamente (o
// chamador desabilita a ação enquanto isPending).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  archivePlatformLead,
  type ArchivePlatformLeadInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseArchivePlatformLeadOptions = {
  authorized: boolean;
};

export const ARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS = {
  notAllowed: 'archive-platform-lead-not-allowed',
  staleContext: 'archive-platform-lead-stale-context',
} as const;

export type ArchivePlatformLeadCallInput = ArchivePlatformLeadInput & {
  isContextStillValid: () => boolean;
};

export type UseArchivePlatformLeadResult = {
  archiveLead: (input: ArchivePlatformLeadCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useArchivePlatformLead(options: UseArchivePlatformLeadOptions): UseArchivePlatformLeadResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, ArchivePlatformLeadCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(ARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(ARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
      }
      return archivePlatformLead(input);
    },
    onSuccess: (_archived, input) => {
      // O Lead sai de 'active' e entra em 'archived' — as duas listas da
      // empresa capturada precisam refletir a mudança.
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsArchived(input.companyId),
      });
    },
  });

  return {
    archiveLead: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
