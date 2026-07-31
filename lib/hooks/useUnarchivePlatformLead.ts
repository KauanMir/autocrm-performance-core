// lib/hooks/useUnarchivePlatformLead.ts — mutation de desarquivamento pela
// superfície platform do Super Admin (M1-F S8-C2-D2). Chama unarchive_lead
// com p_company_id SEMPRE explícito. Mesmo contrato de idempotência de
// useArchivePlatformLead (estado já ativo retorna a linha sem novo bump).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  unarchivePlatformLead,
  type UnarchivePlatformLeadInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseUnarchivePlatformLeadOptions = {
  authorized: boolean;
};

export const UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS = {
  notAllowed: 'unarchive-platform-lead-not-allowed',
  staleContext: 'unarchive-platform-lead-stale-context',
} as const;

export type UnarchivePlatformLeadCallInput = UnarchivePlatformLeadInput & {
  isContextStillValid: () => boolean;
};

export type UseUnarchivePlatformLeadResult = {
  unarchiveLead: (input: UnarchivePlatformLeadCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useUnarchivePlatformLead(
  options: UseUnarchivePlatformLeadOptions,
): UseUnarchivePlatformLeadResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, UnarchivePlatformLeadCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(UNARCHIVE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
      }
      return unarchivePlatformLead(input);
    },
    onSuccess: (unarchived, input) => {
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsArchived(input.companyId),
      });
      // M1-E E7-B2-B2 — unarchive_lead grava evento automático na timeline
      // desde o E7-B2-B1 (nunca no caminho idempotente).
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadTimeline(input.companyId, unarchived.id),
      });
    },
  });

  return {
    unarchiveLead: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
