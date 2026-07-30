// lib/hooks/useCurrentCompanyAssignableSellers.ts — leitura de
// list_current_company_assignable_sellers para Manager/Seller (M1-E, E4-A1).
// Mesmo padrão de lib/hooks/useCurrentCompanySellerLabels.ts/useLeads.ts:
// identidade vem por parâmetro (o componente resolve o usuário ativo),
// useQuery SEMPRE chamado na mesma ordem, `enabled` fazendo o gating —
// nenhum hook condicional.
//
// Nunca monta para Super Admin: Super Admin nunca tem membershipRole
// ('manager' | 'seller'), então a condição de enabled já o exclui
// estruturalmente, sem checagem redundante de platformRole aqui. A
// superfície comercial platform do Super Admin tem sua própria fonte
// (list_platform_sellers_for_company via usePlatformSellers) — nunca esta.
//
// Diferença deliberada de useCurrentCompanySellerLabels: aquele é o
// catálogo de EXIBIÇÃO (nomeia Sellers de Leads existentes, inclusive
// históricos); este é o catálogo de ATRIBUIÇÃO (só quem pode legitimamente
// receber um Lead novo) — nenhum dos dois substitui o outro, e nenhuma UI é
// conectada a este hook nesta etapa (E4-A1 é somente backend/catálogo).
//
// Query key inclui companyId E identityKey: para Manager o resultado é o
// mesmo catálogo independente de qual Manager pergunta, mas para Seller o
// resultado é uma única linha PRÓPRIA — dois Sellers da MESMA empresa nunca
// podem compartilhar uma entrada de cache, ou o resultado de um vazaria
// para o outro.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import {
  fetchCurrentCompanyAssignableSellers,
  toAssignableSellersByIdIndex,
  type AssignableSellerRow,
} from '@/lib/leads/assignableSellersRepository';
import type { LeadSellerRef } from '@/lib/leads/adapter';

export type UseCurrentCompanyAssignableSellersOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseCurrentCompanyAssignableSellersResult = {
  remoteLeadsEnabled: boolean;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  assignableSellers: readonly AssignableSellerRow[];
  // Formato pronto para alimentar um futuro SellerPicker remoto (E4-B2,
  // ainda não conectado) — mesmo shape de sellersById produzido por
  // toSellersByIdIndex (sellerLabelsRepository.ts).
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
// string não vazia no segundo e no quinto segmento). Namespace
// 'assignable' distinto de 'seller-labels' (useCurrentCompanySellerLabels):
// os dois catálogos nunca compartilham entrada de cache.
const DISABLED_QUERY_KEY = ['company', null, 'seller-labels', 'assignable', null] as const;

const EMPTY_ASSIGNABLE_SELLERS: readonly AssignableSellerRow[] = Object.freeze([]);

export function useCurrentCompanyAssignableSellers(
  options: UseCurrentCompanyAssignableSellersOptions,
): UseCurrentCompanyAssignableSellersResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller;

  const queryKey = hasCompany && hasUser
    ? (['company', companyId, 'seller-labels', 'assignable', userId] as const)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Super Admin ou sem membership ⇒
  // enabled=false, zero chamadas).
  const query = useQuery<AssignableSellerRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchCurrentCompanyAssignableSellers,
  });

  const data = query.data ?? null;
  const assignableSellers = data ?? EMPTY_ASSIGNABLE_SELLERS;

  return {
    remoteLeadsEnabled,
    queryEnabled,
    queryKey,
    assignableSellers,
    sellersById: toAssignableSellersByIdIndex(assignableSellers),
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
