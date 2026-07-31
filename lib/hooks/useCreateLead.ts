// lib/hooks/useCreateLead.ts — mutation de criação de Lead para Manager/
// Seller (M1-E, E4-B1). Identidade por parâmetro (mesmo padrão de
// useLeads/useCurrentCompanySellerLabels/useCurrentCompanyAssignableSellers
// — este hook nunca importa AuthService). SEM retry automático
// (create_lead não é idempotente — reenviar cria um SEGUNDO Lead).
//
// Input discriminado por actorRole: a variante 'seller' NÃO TEM campo
// sellerId — o componente futuro (E4-B2) nunca pode compilar um envio de
// vendedor arbitrário pelo Seller, e o repository nunca recebe esse valor
// para esse caminho (backend sempre autoatribui). Manager pode enviar
// sellerId (resolvido pelo catálogo assignable sellers, E4-A1) ou null.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  createRemoteLead,
  type RemoteLeadRecord,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseCreateLeadOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

type CreateLeadCommonFields = {
  name: string;
  phone: string;
  car: string;
  temperature?: Database['public']['Enums']['lead_temperature'];
  paymentPreference?: string;
  source?: string;
};

// Discriminado por actorRole — a variante 'seller' estruturalmente não tem
// sellerId (ver cabeçalho do arquivo).
export type CreateLeadCallInput =
  | (CreateLeadCommonFields & { actorRole: 'manager'; sellerId: string | null })
  | (CreateLeadCommonFields & { actorRole: 'seller' });

export type UseCreateLeadResult = {
  createLead: (input: CreateLeadCallInput) => Promise<RemoteLeadRecord>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CreateLeadMutationResult = {
  record: RemoteLeadRecord;
  capturedCompanyId: string;
};

export function useCreateLead(options: UseCreateLeadOptions): UseCreateLeadResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateLeadMutationResult, unknown, CreateLeadCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      // Sem identidade operacional (sem membership, suspenso, offboarded,
      // profile inativo, Super Admin — que nunca tem membershipRole) OU
      // actorRole do input divergente da identidade atual do hook: falha
      // fechado, nunca chama a RPC. Mesmo código de erro nos dois casos —
      // ambos significam "não autorizado a criar por este caminho agora".
      if (!hasIdentity || input.actorRole !== membershipRole) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'create_lead');
      }

      // Geração capturada ANTES da chamada de rede — comparada de novo
      // depois da resposta (lib/query/cacheIdentity.ts, M1-D).
      const capturedGeneration = getQueryCacheGeneration(queryClient);
      const capturedCompanyId = companyId as string;

      const record = await createRemoteLead(
        input.actorRole === 'manager'
          ? {
              name: input.name,
              phone: input.phone,
              car: input.car,
              sellerId: input.sellerId,
              temperature: input.temperature,
              paymentPreference: input.paymentPreference,
              source: input.source,
            }
          : {
              // Seller: p_seller_id nunca enviado (nem undefined explícito
              // no payload) — o backend sempre autoatribui.
              name: input.name,
              phone: input.phone,
              car: input.car,
              temperature: input.temperature,
              paymentPreference: input.paymentPreference,
              source: input.source,
            },
      );

      // A escrita já aconteceu no servidor — se a identidade mudou no meio
      // (logout/troca de empresa/membership), nunca surgimos como sucesso
      // para a sessão nova: lançamos identity_changed em vez de retornar.
      // onSuccess (abaixo) nunca roda neste caso, então nenhuma
      // invalidation contamina a identidade nova. Nenhum AbortController —
      // não há promessa de cancelamento transacional.
      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('create_lead');
      }

      return { record, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.active(capturedCompanyId) });
      // M1-E E7-B2-B2 — deliberadamente SEM invalidação de
      // leadQueryKeys.timeline aqui, embora create_lead grave um evento
      // automático ("Lead criado", E7-B2-B1): o Lead não existia antes
      // desta chamada, então nenhum componente pode ter montado
      // useLeadTimeline para este leadId ainda — a query dessa key nunca
      // esteve em cache, e invalidar uma key que nunca foi observada é
      // no-op puro (nenhum efeito, nenhum benefício). Quando o Lead recém-
      // criado for aberto pela primeira vez, useLeadTimeline monta sem
      // cache e busca os dados reais (incluindo "Lead criado") no primeiro
      // fetch — sem precisar de nenhuma invalidação prévia.
    },
  });

  return {
    createLead: async (input) => (await mutation.mutateAsync(input)).record,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
