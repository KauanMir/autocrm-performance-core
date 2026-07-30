// lib/hooks/useCurrentCompanySellerLabels.ts — leitura de
// list_current_company_seller_labels para Manager/Seller (M1-E, E3-A1).
// Mesmo padrão de lib/hooks/useLeads.ts/usePipelineStages.ts: identidade
// vem por parâmetro (o componente resolve o usuário ativo), useQuery
// SEMPRE chamado na mesma ordem, `enabled` fazendo o gating — nenhum hook
// condicional.
//
// Nunca monta para Super Admin: Super Admin nunca tem membershipRole
// ('manager' | 'seller'), então a condição de enabled já o exclui
// estruturalmente, sem checagem redundante de platformRole aqui. A
// superfície comercial platform do Super Admin tem sua própria fonte
// (list_platform_sellers_for_company via usePlatformSellers) — nunca esta.
//
// Query key inclui companyId E identityKey: para Manager o resultado é o
// mesmo catálogo independente de qual Manager pergunta, mas para Seller o
// resultado é uma única linha PRÓPRIA — dois Sellers da MESMA empresa nunca
// podem compartilhar uma entrada de cache, ou o resultado de um vazaria
// para o outro.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import {
  fetchCurrentCompanySellerLabels,
  toSellersByIdIndex,
  type SellerLabelRow,
} from '@/lib/leads/sellerLabelsRepository';
import type { LeadSellerRef } from '@/lib/leads/adapter';

export type UseCurrentCompanySellerLabelsOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseCurrentCompanySellerLabelsResult = {
  remoteLeadsEnabled: boolean;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  sellerLabels: readonly SellerLabelRow[];
  // Formato pronto para alimentar LeadAdapterContext.sellersById
  // (adaptLeadRows, lib/leads/adapter.ts, intocado por esta etapa) — E3-B1
  // consome isto diretamente, sem reimplementar a indexação.
  sellersById: Readonly<Record<string, LeadSellerRef>>;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando a query está desabilitada (enabled=
// false, zero requests) — nunca colide com uma key real (que sempre tem
// string não vazia no segundo e no quinto segmento).
const DISABLED_QUERY_KEY = ['company', null, 'seller-labels', 'remote', null] as const;

const EMPTY_SELLER_LABELS: readonly SellerLabelRow[] = Object.freeze([]);

export function useCurrentCompanySellerLabels(
  options: UseCurrentCompanySellerLabelsOptions,
): UseCurrentCompanySellerLabelsResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller;

  const queryKey = hasCompany && hasUser
    ? (['company', companyId, 'seller-labels', 'remote', userId] as const)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Super Admin ou sem membership ⇒
  // enabled=false, zero chamadas).
  const query = useQuery<SellerLabelRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchCurrentCompanySellerLabels,
  });

  const data = query.data ?? null;
  const sellerLabels = data ?? EMPTY_SELLER_LABELS;

  return {
    remoteLeadsEnabled,
    queryEnabled,
    queryKey,
    sellerLabels,
    sellersById: toSellersByIdIndex(sellerLabels),
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
