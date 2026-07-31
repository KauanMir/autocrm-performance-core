// lib/hooks/useUpdateLead.ts — mutation de edição de Lead para Manager/
// Seller (M1-E, E4-B1). Identidade por parâmetro (mesmo padrão de
// useCreateLead/useLeads). SEM retry automático — update_lead usa
// optimistic locking via expectedVersion/version (retry cego reenviaria
// uma versão já obsoleta). SEM mutation otimista: o valor exibido só muda
// depois da resposta real, via invalidation (nunca escrita direta em
// cache/snapshot).
//
// Campos permitidos: leadId, expectedVersion, name, phone, car,
// temperature, paymentPreference, source — nenhum stage, seller,
// companyId, urgency, archived ou timeline (a RPC nem os aceita).
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  updateRemoteLead,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseUpdateLeadOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UpdateLeadCallInput = {
  leadId: string;
  expectedVersion: number;
  name: string;
  phone: string;
  car: string;
  temperature?: Database['public']['Enums']['lead_temperature'];
  paymentPreference?: string;
  source?: string;
};

export type UseUpdateLeadResult = {
  updateLead: (input: UpdateLeadCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type UpdateLeadMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
  leadId: string;
};

export function useUpdateLead(options: UseUpdateLeadOptions): UseUpdateLeadResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateLeadMutationResult, unknown, UpdateLeadCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'update_lead');
      }
      if (typeof input.expectedVersion !== 'number') {
        // expectedVersion obrigatório — divergência real (versão ausente)
        // recebe o mesmo código que o backend usaria para a mesma condição.
        throw mapRemoteLeadsMutationError({ message: 'stale_write' }, 'update_lead');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await updateRemoteLead({
        leadId: input.leadId,
        expectedVersion: input.expectedVersion,
        name: input.name,
        phone: input.phone,
        car: input.car,
        temperature: input.temperature,
        paymentPreference: input.paymentPreference,
        source: input.source,
      });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('update_lead');
      }

      return { record, capturedCompanyId, leadId: input.leadId };
    },
    onSuccess: ({ capturedCompanyId, leadId }) => {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
      // Key reservada desde o E2 (lib/leads/queryKeys.ts), sem consumidor
      // ainda — invalidação antecipada e inofensiva (nenhuma query
      // observada nesta key hoje), pronta para quando um detalhe dedicado
      // existir.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(capturedCompanyId, leadId) });
      // M1-E E7-B2-B2 — update_lead grava evento automático na timeline
      // desde o E7-B2-B1 (mesma transação da RPC); invalida a timeline
      // exata para a UI já aberta (RemoteLeadTimelinePanel) refletir o
      // evento sem precisar de F5/remontagem.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, leadId) });
    },
  });

  return {
    updateLead: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
