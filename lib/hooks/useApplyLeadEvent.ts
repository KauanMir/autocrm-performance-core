// lib/hooks/useApplyLeadEvent.ts — mutation de aplicação de evento de saúde
// (Health Engine) para Manager/Seller (M1-E, E5-A1). Identidade por
// parâmetro (mesmo padrão de useCreateLead/useUpdateLead/
// useMoveLeadToStage). SEM retry automático — apply_lead_event não é
// idempotente (cada aplicação é um evento novo, mesmo raciocínio de
// add_lead_timeline_entry/useApplyPlatformLeadEvent).
//
// apply_lead_event nunca grava em lead_timeline_entries (contrato real,
// confirmado na auditoria E5-A0) — por isso este hook NUNCA chama
// LeadService.addToTimeline, NUNCA chama add_lead_timeline_entry, e invalida
// somente a lista de Leads ativos, nunca a timeline. A solução atômica de
// evento+timeline fica reservada ao E7 (decisão humana #5 do E5-A1).
//
// eventType é tipado pelo enum real (Database['public']['Enums']
// ['lead_event_type']) — nunca aceita texto livre. A conversão de
// LeadHealthEvent para esse enum é responsabilidade do chamador via
// lib/leads/leadEventMapper.ts, nunca deste hook.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  applyRemoteLeadEvent,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseApplyLeadEventOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type ApplyLeadEventCallInput = {
  leadId: string;
  eventType: Database['public']['Enums']['lead_event_type'];
};

export type UseApplyLeadEventResult = {
  applyLeadEvent: (input: ApplyLeadEventCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type ApplyLeadEventMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useApplyLeadEvent(options: UseApplyLeadEventOptions): UseApplyLeadEventResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<ApplyLeadEventMutationResult, unknown, ApplyLeadEventCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'apply_lead_event');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await applyRemoteLeadEvent({
        leadId: input.leadId,
        eventType: input.eventType,
      });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('apply_lead_event');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      // Nunca invalida timeline aqui — apply_lead_event não a altera.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
    },
  });

  return {
    applyLeadEvent: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
