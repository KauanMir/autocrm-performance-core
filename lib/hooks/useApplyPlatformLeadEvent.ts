// lib/hooks/useApplyPlatformLeadEvent.ts — mutation de registro de evento
// comercial pela superfície platform do Super Admin (M1-F S8-C2-D2). Chama
// apply_lead_event com p_company_id SEMPRE explícito. Eventos reais listados
// em lib/commercial/leadEventRegistry.ts (18 valores de lead_event_type,
// nenhum payload adicional aceito pela RPC).
//
// apply_lead_event nunca grava em lead_timeline_entries (confirmado no
// contrato real da RPC — só atualiza urgency/labels/stage_id/version em
// leads) — por isso só a lista de Leads ativos é invalidada, nunca a
// timeline do Lead.
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
    onSuccess: (_updated, input) => {
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
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
