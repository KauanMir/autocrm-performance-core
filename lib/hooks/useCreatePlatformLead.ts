// lib/hooks/useCreatePlatformLead.ts — mutation de criação de Lead pela
// superfície platform do Super Admin (M1-F S8-C2-C2). Chama create_lead com
// p_company_id SEMPRE explícito — nunca a empresa "atual" no momento da
// resposta, sempre a capturada pelo formulário na abertura (proteção contra
// troca de empresa em voo, decisão §11 do design).
//
// SEM retry automático (mutations.retry já é 0 no QueryClient padrão) —
// create_lead não é idempotente (chamar de novo cria um SEGUNDO Lead).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import {
  createPlatformLead,
  type CreatePlatformLeadInput,
  type PlatformLeadRecord,
} from '@/lib/commercial/repository';

export type UseCreatePlatformLeadOptions = {
  // Resolvido pelo chamador: canMutateCommercialWorkspace(...).
  authorized: boolean;
};

// Mensagens estáveis dos erros LOCAIS (pré-RPC) — nunca exibidas cruas ao
// usuário, mesmo padrão de CREATE_COMPANY_LOCAL_ERRORS (useCreateCompany).
export const CREATE_PLATFORM_LEAD_LOCAL_ERRORS = {
  notAllowed: 'create-platform-lead-not-allowed',
  staleContext: 'create-platform-lead-stale-context',
} as const;

export type CreatePlatformLeadCallInput = CreatePlatformLeadInput & {
  // Verificado IMEDIATAMENTE antes de enviar a RPC — se retornar false
  // (companyId mudou, a empresa deixou de ser ativa/implantacao, a flag
  // caiu...), a mutation NUNCA chama o Supabase. Resolvido pelo chamador (o
  // formulário, via companyId/contextEpoch capturados na abertura) — este
  // hook nunca decide sozinho o que é "válido".
  isContextStillValid: () => boolean;
};

export type UseCreatePlatformLeadResult = {
  createLead: (input: CreatePlatformLeadCallInput) => Promise<PlatformLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useCreatePlatformLead(options: UseCreatePlatformLeadOptions): UseCreatePlatformLeadResult {
  const { authorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<PlatformLeadRecord, unknown, CreatePlatformLeadCallInput>({
    mutationFn: async (input) => {
      if (!authorized) throw new Error(CREATE_PLATFORM_LEAD_LOCAL_ERRORS.notAllowed);
      if (!input.isContextStillValid()) {
        throw new Error(CREATE_PLATFORM_LEAD_LOCAL_ERRORS.staleContext);
      }
      return createPlatformLead(input);
    },
    onSuccess: (_created, input) => {
      // Invalida SOMENTE a key da empresa CAPTURADA (input.companyId) —
      // nunca a empresa selecionada no momento da resposta, nunca um reset
      // global. As keys já são particionadas por companyId, então isto
      // nunca toca o cache de outra empresa mesmo se a seleção já tiver
      // mudado quando a resposta chega.
      queryClient.invalidateQueries({
        queryKey: platformCommercialQueryKeys.leadsActive(input.companyId),
      });
      // M1-E E7-B2-B2 — deliberadamente SEM invalidação de
      // platformCommercialQueryKeys.leadTimeline aqui, mesma razão de
      // useCreateLead (caminho operacional): o Lead não existia antes desta
      // chamada, então nenhum PlatformLeadDetails pode ter montado
      // usePlatformLeadTimeline para este id ainda — invalidar uma key
      // nunca observada é no-op puro. O primeiro fetch ao abrir o Lead
      // recém-criado já busca os dados reais.
    },
  });

  return {
    createLead: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
