// lib/hooks/useAddLeadTimelineEntry.ts — mutation de nota manual na timeline
// remota de um Lead para Manager/Seller (M1-E, E7-B2-A1). Chama
// add_lead_timeline_entry (mesma RPC já usada pela superfície Platform, ver
// lib/hooks/useAddPlatformLeadTimelineEntry.ts) com icon/color/label FIXOS
// (lib/leads/timelineRepository.ts) — o usuário só escreve `detail`.
//
// Identidade por parâmetro (mesmo padrão de useUpdateLead/useAssignLeadSeller)
// — protegida por geração de cache (lib/query/cacheIdentity.ts): se a
// identidade mudar entre o início e o fim da chamada (logout/troca de
// empresa/membership em voo), a resposta é descartada via identity_changed,
// nunca aplicada à identidade errada. SEM retry automático e SEM mutation
// otimista (decisões da etapa) — o texto só aparece na lista depois da
// invalidação real.
//
// add_lead_timeline_entry NUNCA altera a linha de leads (só insere em
// lead_timeline_entries) — por isso só a timeline específica
// (companyId+leadId) é invalidada, nunca active/archived/detail (mesma
// decisão já documentada em useAddPlatformLeadTimelineEntry). Nenhuma
// mutation E4/E5/E6 é tocada por este arquivo.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { addLeadTimelineNote } from '@/lib/leads/timelineRepository';
import type { LeadTimelineEntryRow } from '@/lib/supabase/types';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseAddLeadTimelineEntryOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type AddLeadTimelineEntryCallInput = {
  leadId: string;
  detail: string;
};

export type UseAddLeadTimelineEntryResult = {
  addTimelineEntry: (input: AddLeadTimelineEntryCallInput) => Promise<LeadTimelineEntryRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type AddLeadTimelineEntryMutationResult = {
  record: LeadTimelineEntryRow;
  capturedCompanyId: string;
  leadId: string;
};

export function useAddLeadTimelineEntry(
  options: UseAddLeadTimelineEntryOptions,
): UseAddLeadTimelineEntryResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<AddLeadTimelineEntryMutationResult, unknown, AddLeadTimelineEntryCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'add_lead_timeline_entry');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await addLeadTimelineNote({ leadId: input.leadId, detail: input.detail });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('add_lead_timeline_entry');
      }

      return { record, capturedCompanyId, leadId: input.leadId };
    },
    onSuccess: ({ capturedCompanyId, leadId }) => {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, leadId) });
    },
  });

  return {
    addTimelineEntry: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
