// lib/hooks/useArchiveLead.ts — mutation de arquivamento de Lead para
// Manager (M1-E, E6-B1). Nenhuma UI conectada nesta etapa.
//
// Manager-only, sem exceção: archive_lead proíbe Seller de forma
// incondicional no backend (raise exception 'forbidden' fixo, confirmado na
// auditoria E6-A0) — bloqueio aqui é sempre Manager, nunca via
// canActorMutateLead. SEM retry automático — expectedVersion é sempre
// obrigatório no tipo do hook, mesmo com o comportamento idempotente da RPC
// (Lead já arquivado retorna o estado atual sem novo bump de version, mas o
// frontend continua enviando expectedVersion sempre). SEM mutation
// otimista — nenhuma escrita direta em cache/snapshot, só invalidation após
// resposta real.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  archiveRemoteLead,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseArchiveLeadOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type ArchiveLeadCallInput = {
  leadId: string;
  expectedVersion: number;
};

export type UseArchiveLeadResult = {
  archiveLead: (input: ArchiveLeadCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type ArchiveLeadMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useArchiveLead(options: UseArchiveLeadOptions): UseArchiveLeadResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<ArchiveLeadMutationResult, unknown, ArchiveLeadCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && membershipRole === 'manager';

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'archive_lead');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteLeadsMutationError({ message: 'stale_write' }, 'archive_lead');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await archiveRemoteLead({
        leadId: input.leadId,
        expectedVersion: input.expectedVersion,
      });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('archive_lead');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      // O Lead sai de ativos e entra em arquivados — mesmas duas keys que a
      // superfície Platform (useArchivePlatformLead) invalida.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.archived(capturedCompanyId) });
    },
  });

  return {
    archiveLead: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
