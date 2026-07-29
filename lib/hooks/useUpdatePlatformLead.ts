// lib/hooks/useUpdatePlatformLead.ts — mutation de edição de Lead pela
// superfície platform do Super Admin (M1-F S8-C2-C2). Chama update_lead com
// APENAS os campos reais do seu contrato (name/phone/car/temperature/
// payment_preference/source) — nunca seller_id/stage/archived_at/timeline
// (a RPC nem os aceita; decisão #8 do S8-C2-C2: editar nunca move Etapa nem
// atribui Vendedor). p_company_id SEMPRE a empresa capturada na abertura do
// formulário, nunca a selecionada no momento da resposta.
//
// SEM retry automático — update_lead usa optimistic locking via
// p_expected_version/version (retry cego reenviaria uma versão já obsoleta).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  updatePlatformLead,
  type UpdatePlatformLeadInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseUpdatePlatformLeadOptions = {
  // Resolvido pelo chamador: canMutateCommercialWorkspace(...).
  authorized: boolean;
};

export const UPDATE_PLATFORM_LEAD_LOCAL_ERRORS = {
  notAllowed: 'update-platform-lead-not-allowed',
  staleContext: 'update-platform-lead-stale-context',
} as const;

export type UpdatePlatformLeadCallInput = UpdatePlatformLeadInput & {
  // Mesmo contrato de CreatePlatformLeadCallInput.isContextStillValid —
  // verificado imediatamente antes de enviar a RPC.
  isContextStillValid: () => boolean;
};

export type UseUpdatePlatformLeadResult = {
  updateLead: (input: UpdatePlatformLeadCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useUpdatePlatformLead(options: UseUpdatePlatformLeadOptions): UseUpdatePlatformLeadResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, UpdatePlatformLeadCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(UPDATE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(UPDATE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
      }
      return updatePlatformLead(input);
    },
    onSuccess: (_updated, input) => {
      // update_lead recusa com 'lead_archived' qualquer Lead já arquivado —
      // a única lista afetada é sempre 'active' da empresa capturada, nunca
      // 'archived'.
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
    },
  });

  return {
    updateLead: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
