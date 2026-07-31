// lib/hooks/useAssignLeadSeller.ts — mutation de atribuição/troca/remoção
// de vendedor para Manager (M1-E, E6-B1). Nenhuma UI conectada nesta etapa.
//
// Manager-only, sem exceção: assign_lead_seller proíbe Seller de forma
// incondicional no backend (raise exception 'forbidden' fixo, confirmado na
// auditoria E6-A0) — diferente de canMoveStage/canLogCallOutcome, este
// bloqueio NUNCA usa canActorMutateLead (aquele helper é só para posse de
// Lead entre Manager/Seller, não se aplica aqui). SEM retry automático —
// expectedVersion é sempre obrigatório (nunca LWW, diferente de
// move_lead_to_stage); um retry cego reenviaria uma versão já obsoleta. SEM
// mutation otimista.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  assignRemoteLeadSeller,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseAssignLeadSellerOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type AssignLeadSellerCallInput = {
  leadId: string;
  // null remove o vendedor (contrato real da RPC).
  sellerId: string | null;
  expectedVersion: number;
};

export type UseAssignLeadSellerResult = {
  assignLeadSeller: (input: AssignLeadSellerCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type AssignLeadSellerMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useAssignLeadSeller(options: UseAssignLeadSellerOptions): UseAssignLeadSellerResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<AssignLeadSellerMutationResult, unknown, AssignLeadSellerCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && membershipRole === 'manager';

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'assign_lead_seller');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteLeadsMutationError({ message: 'stale_write' }, 'assign_lead_seller');
      }

      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await assignRemoteLeadSeller({
        leadId: input.leadId,
        sellerId: input.sellerId,
        expectedVersion: input.expectedVersion,
      });

      // Mesma proteção de identidade do E4/E5: a escrita já pode ter
      // concluído no servidor — se a identidade mudou no meio (logout/troca
      // de empresa/membership), nunca aterrissamos como sucesso na
      // identidade nova. Nenhum AbortController.
      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('assign_lead_seller');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId, record }) => {
      // assign_lead_seller recusa Lead arquivado (lead_archived) — só a
      // lista de ativos é afetada, nunca a de arquivados.
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
      // M1-E E7-B2-B2 — assign_lead_seller grava evento automático na
      // timeline desde o E7-B2-B1 (só quando o vendedor realmente muda, ver
      // migration) — invalida a timeline exata, tanto para atribuição
      // quanto para remoção (sellerId null).
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, record.id) });
    },
  });

  return {
    assignLeadSeller: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}

// Helper puro reservado para a UI futura (E6-B2): trocar de vendedor para o
// MESMO vendedor não deve chamar a RPC — decisão humana do E6-A0 (nenhum
// loading, nenhum bump de version, nenhuma invalidation, nenhum falso
// sucesso). null === null (sem vendedor -> sem vendedor) também é no-op.
// Não consumido por nenhuma UI nesta etapa.
export function isNoOpSellerAssignment(
  currentSellerId: string | null,
  nextSellerId: string | null,
): boolean {
  return currentSellerId === nextSellerId;
}
