// lib/hooks/useAddPlatformLeadTimelineEntry.ts — mutation de entrada manual
// de timeline pela superfície platform do Super Admin (M1-F S8-C2-D2).
// Chama add_lead_timeline_entry com p_company_id SEMPRE explícito.
//
// add_lead_timeline_entry NUNCA altera a linha de leads (só insere em
// lead_timeline_entries) — por isso só a timeline específica (companyId +
// leadId) é invalidada, nunca as listas de Leads ativos/arquivados. A
// timeline comercial permanece inteiramente separada do audit_log (o
// backend já grava o Super Admin real lá quando aplicável — nenhuma
// escrita de audit_log acontece no frontend).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  addPlatformLeadTimelineEntry,
  type AddPlatformLeadTimelineEntryInput,
  type PlatformLeadTimelineEntryRecord,
} from '@/lib/commercial/repository';

export type UseAddPlatformLeadTimelineEntryOptions = {
  authorized: boolean;
};

export const ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS = {
  notAllowed: 'add-platform-lead-timeline-entry-not-allowed',
  staleContext: 'add-platform-lead-timeline-entry-stale-context',
} as const;

export type AddPlatformLeadTimelineEntryCallInput = AddPlatformLeadTimelineEntryInput & {
  isContextStillValid: () => boolean;
};

export type UseAddPlatformLeadTimelineEntryResult = {
  addTimelineEntry: (input: AddPlatformLeadTimelineEntryCallInput) => Promise<PlatformLeadTimelineEntryRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useAddPlatformLeadTimelineEntry(
  options: UseAddPlatformLeadTimelineEntryOptions,
): UseAddPlatformLeadTimelineEntryResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadTimelineEntryRecord, unknown, AddPlatformLeadTimelineEntryCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(ADD_PLATFORM_LEAD_TIMELINE_ENTRY_LOCAL_ERRORS.staleContext);
      }
      return addPlatformLeadTimelineEntry(input);
    },
    onSuccess: (_entry, input) => {
      // Invalida SOMENTE a timeline do Lead+empresa capturados — nunca
      // todas as empresas, nunca as listas de Leads (a RPC não toca
      // leads.*).
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadTimeline(input.companyId, input.leadId),
      });
    },
  });

  return {
    addTimelineEntry: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
