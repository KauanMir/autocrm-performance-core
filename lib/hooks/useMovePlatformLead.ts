// lib/hooks/useMovePlatformLead.ts — mutation de movimentação de etapa pela
// superfície platform do Super Admin (M1-F S8-C2-D2). Chama
// move_lead_to_stage com p_company_id SEMPRE explícito (a empresa
// capturada pelo chamador, nunca a selecionada no momento da resposta).
//
// SEM retry automático (mutations.retry já é 0 no QueryClient padrão) —
// move_lead_to_stage aceita p_expected_version opcional (last-write-wins
// quando omitida, contrato real preservado) ou optimistic locking quando
// enviada; um retry cego reenviaria uma versão potencialmente obsoleta.
//
// M1-E E7-B2-B1: move_lead_to_stage passou a gravar um evento automático em
// lead_timeline_entries (só quando a etapa realmente muda, decidido no
// servidor) — este hook nunca escreve na timeline diretamente, só invalida
// a key Platform exata (E7-B2-B2) para a UI já aberta buscar o evento real.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  movePlatformLeadToStage,
  type MovePlatformLeadInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseMovePlatformLeadOptions = {
  // Resolvido pelo chamador: canMutateCommercialWorkspace(...).
  authorized: boolean;
};

export const MOVE_PLATFORM_LEAD_LOCAL_ERRORS = {
  notAllowed: 'move-platform-lead-not-allowed',
  staleContext: 'move-platform-lead-stale-context',
} as const;

export type MovePlatformLeadCallInput = MovePlatformLeadInput & {
  // Verificado IMEDIATAMENTE antes de enviar a RPC — mesmo contrato de
  // CreatePlatformLeadCallInput.isContextStillValid.
  isContextStillValid: () => boolean;
};

export type UseMovePlatformLeadResult = {
  moveLead: (input: MovePlatformLeadCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useMovePlatformLead(options: UseMovePlatformLeadOptions): UseMovePlatformLeadResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, MovePlatformLeadCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(MOVE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(MOVE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
      }
      return movePlatformLeadToStage(input);
    },
    onSuccess: (moved, input) => {
      // move_lead_to_stage recusa com 'lead_archived' qualquer Lead já
      // arquivado — a única lista afetada é sempre 'active' da empresa
      // capturada.
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadTimeline(input.companyId, moved.id),
      });
    },
  });

  return {
    moveLead: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
