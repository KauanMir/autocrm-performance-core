// lib/hooks/useAssignPlatformLeadSeller.ts — mutation de atribuição/troca/
// remoção de vendedor pela superfície platform do Super Admin (M1-F
// S8-C2-D2). Chama assign_lead_seller com p_company_id SEMPRE explícito.
// sellerId null remove o vendedor (contrato real da RPC) — nunca
// profile_id/membership_id, sempre o seller_id real da empresa selecionada
// (list_platform_sellers_for_company).
//
// SEM retry automático — assign_lead_seller exige p_expected_version
// sempre (nunca last-write-wins, diferente de move_lead_to_stage); um
// retry cego reenviaria uma versão já obsoleta.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  assignPlatformLeadSeller,
  type AssignPlatformLeadSellerInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseAssignPlatformLeadSellerOptions = {
  authorized: boolean;
};

export const ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS = {
  notAllowed: 'assign-platform-lead-seller-not-allowed',
  staleContext: 'assign-platform-lead-seller-stale-context',
} as const;

export type AssignPlatformLeadSellerCallInput = AssignPlatformLeadSellerInput & {
  isContextStillValid: () => boolean;
};

export type UseAssignPlatformLeadSellerResult = {
  assignSeller: (input: AssignPlatformLeadSellerCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useAssignPlatformLeadSeller(
  options: UseAssignPlatformLeadSellerOptions,
): UseAssignPlatformLeadSellerResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, AssignPlatformLeadSellerCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(ASSIGN_PLATFORM_LEAD_SELLER_LOCAL_ERRORS.staleContext);
      }
      return assignPlatformLeadSeller(input);
    },
    onSuccess: (updated, input) => {
      // assign_lead_seller recusa 'lead_archived' — só Leads ativos podem
      // ser atribuídos.
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      // M1-E E7-B2-B2 — assign_lead_seller grava evento automático na
      // timeline desde o E7-B2-B1 (só quando o vendedor muda de fato).
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadTimeline(input.companyId, updated.id),
      });
    },
  });

  return {
    assignSeller: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
