// lib/hooks/useUnarchiveLead.ts — mutation de restauração de Lead para
// Manager (M1-E, E6-B1). Nenhuma UI conectada nesta etapa.
//
// Manager-only, sem exceção: unarchive_lead proíbe Seller de forma
// incondicional no backend (raise exception 'forbidden' fixo, confirmado na
// auditoria E6-A0) — bloqueio aqui é sempre Manager, nunca via
// canActorMutateLead. SEM retry automático — expectedVersion sempre
// obrigatório no tipo do hook, mesmo com o comportamento idempotente da RPC
// (Lead já ativo retorna o estado atual sem novo bump de version). SEM
// mutation otimista.
//
// Contrato mantido EXATAMENTE como está (achado do E6-A1, docs/M1-E-DESIGN
// .md §15.12): nenhum p_restore_stage_id — a restauração sempre preserva o
// stage_id/seller_id existentes do Lead, porque pipeline_stages não tem
// nenhum conceito de etapa ativa/inativa no schema atual (sem coluna, sem
// policy de DELETE, FK leads.stage_id ON DELETE RESTRICT garante que o
// stage_id de um Lead sempre existe e pertence à empresa certa).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  unarchiveRemoteLead,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseUnarchiveLeadOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UnarchiveLeadCallInput = {
  leadId: string;
  expectedVersion: number;
};

export type UseUnarchiveLeadResult = {
  unarchiveLead: (input: UnarchiveLeadCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type UnarchiveLeadMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useUnarchiveLead(options: UseUnarchiveLeadOptions): UseUnarchiveLeadResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UnarchiveLeadMutationResult, unknown, UnarchiveLeadCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && membershipRole === 'manager';

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'unarchive_lead');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteLeadsMutationError({ message: 'stale_write' }, 'unarchive_lead');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await unarchiveRemoteLead({
        leadId: input.leadId,
        expectedVersion: input.expectedVersion,
      });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('unarchive_lead');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.archived(capturedCompanyId) });
    },
  });

  return {
    unarchiveLead: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
