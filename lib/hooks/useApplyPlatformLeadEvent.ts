// lib/hooks/useApplyPlatformLeadEvent.ts — mutation de registro de evento
// comercial pela superfície platform do Super Admin (M1-F S8-C2-D2). Chama
// apply_lead_event com p_company_id SEMPRE explícito. Eventos reais listados
// em lib/commercial/leadEventRegistry.ts (18 valores de lead_event_type,
// nenhum payload adicional aceito pela RPC).
//
// M1-E E7-B2-B1: apply_lead_event passou a gravar um evento automático em
// lead_timeline_entries na mesma transação — este hook nunca escreve na
// timeline diretamente (nunca chama add_lead_timeline_entry, nunca
// duplica), só invalida a key Platform exata (E7-B2-B2).
//
// SEM retry automático — reenviar cegamente um evento após falha de rede
// poderia aplicar o mesmo evento duas vezes (a RPC não é idempotente por
// design: cada aplicação é um evento novo, mesmo padrão de
// add_lead_timeline_entry).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  applyPlatformLeadEvent,
  type ApplyPlatformLeadEventInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseApplyPlatformLeadEventOptions = {
  authorized: boolean;
};

export const APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS = {
  notAllowed: 'apply-platform-lead-event-not-allowed',
  staleContext: 'apply-platform-lead-event-stale-context',
} as const;

export type ApplyPlatformLeadEventCallInput = ApplyPlatformLeadEventInput & {
  isContextStillValid: () => boolean;
};

export type UseApplyPlatformLeadEventResult = {
  applyEvent: (input: ApplyPlatformLeadEventCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useApplyPlatformLeadEvent(
  options: UseApplyPlatformLeadEventOptions,
): UseApplyPlatformLeadEventResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, ApplyPlatformLeadEventCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(APPLY_PLATFORM_LEAD_EVENT_LOCAL_ERRORS.staleContext);
      }
      return applyPlatformLeadEvent(input);
    },
    onSuccess: (updated, input) => {
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadTimeline(input.companyId, updated.id),
      });
    },
  });

  return {
    applyEvent: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
