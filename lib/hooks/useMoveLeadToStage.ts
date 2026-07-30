// lib/hooks/useMoveLeadToStage.ts — mutation de movimento de Etapa (Kanban)
// para Manager/Seller (M1-E, E5-A1). Identidade por parâmetro (mesmo padrão
// de useCreateLead/useUpdateLead). SEM retry automático — move_lead_to_stage
// não recebe expectedVersion neste caminho (decisão humana #1/#3/#11 do
// E5-A1: drag é sempre last-write-wins, sem optimistic locking, sem
// atualização otimista de UI — o card só sai da coluna atual depois que o
// backend confirmar, comportamento implementado no E5-B1, não aqui).
//
// Este hook NUNCA decide drag, same-stage no-op ou qual componente chamá-lo
// — isso pertence ao E5-B1. Nunca importa PipelineService/StoreAdapter
// (aquele caminho permanece exclusivo do modo local).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  moveRemoteLeadToStage,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseMoveLeadToStageOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type MoveLeadToStageCallInput = {
  leadId: string;
  stageId: string;
};

export type UseMoveLeadToStageResult = {
  moveLeadToStage: (input: MoveLeadToStageCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type MoveLeadToStageMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useMoveLeadToStage(options: UseMoveLeadToStageOptions): UseMoveLeadToStageResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<MoveLeadToStageMutationResult, unknown, MoveLeadToStageCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'move_lead_to_stage');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await moveRemoteLeadToStage({
        leadId: input.leadId,
        stageId: input.stageId,
      });

      // Mesma proteção de identidade do E4-B1 (create/update): a escrita já
      // pode ter concluído no servidor — se a identidade mudou no meio
      // (logout/troca de empresa/membership), nunca aterrissamos como
      // sucesso na identidade nova. onSuccess nunca roda neste caso. Nenhum
      // AbortController — não há promessa de cancelamento transacional.
      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('move_lead_to_stage');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
    },
  });

  return {
    moveLeadToStage: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}

// Helper puro reservado para o E5-B1: soltar um card na própria coluna atual
// não deve chamar a RPC (nenhuma mudança de estado a persistir). Não é
// consumido por nenhuma UI nesta etapa.
export function isNoOpStageMove(currentStageId: string, targetStageId: string): boolean {
  return currentStageId === targetStageId;
}
