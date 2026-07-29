// lib/hooks/usePlatformSellers.ts — leitura de list_platform_sellers_for_company
// para o Seller picker do Super Admin (M1-F S8-C2-C2). Mesmo padrão de
// usePlatformLeads/usePlatformPipelineStages: caminho 'platform', nunca
// public.sellers direto, nunca compartilhado com nenhum caminho RLS de
// Manager/Seller.
//
// seller_id é identidade POR EMPRESA (achado da S8-C2-C2-SELLERS-B1:
// transfer_membership cria uma linha sellers NOVA na empresa destino) — a
// troca de `companyId` já invalida a query automaticamente (key diferente),
// então uma seleção antiga nunca sobrevive à troca por si só. Cabe ao
// CHAMADOR (formulário de create/edit) limpar a seleção explícita quando o
// seller escolhido não aparece mais na lista recarregada — este hook só
// expõe os dados, nunca decide isso.
import { useQuery } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { fetchPlatformSellers, type PlatformSellerRow } from '@/lib/commercial/repository';

export type UsePlatformSellersOptions = {
  companyId: string | null;
  // Resolvido pelo chamador (canMutateCommercialWorkspace(...)) — este hook
  // não decide autorização. Nunca montado (enabled=false) fora do modo
  // write-capável, para nunca disparar uma requisição desnecessária em modo
  // somente leitura.
  authorized: boolean;
};

export type UsePlatformSellersResult = {
  queryEnabled: boolean;
  sellers: readonly PlatformSellerRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const DISABLED_QUERY_KEY = ['company', null, 'commercial-sellers', 'platform', 'disabled'] as const;
const EMPTY_SELLERS: readonly PlatformSellerRow[] = Object.freeze([]);

export function usePlatformSellers(options: UsePlatformSellersOptions): UsePlatformSellersResult {
  const { companyId, authorized } = options;
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const queryEnabled = authorized && hasCompany;
  const queryKey = hasCompany
    ? platformCommercialQueryKeys.sellers(companyId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<PlatformSellerRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchPlatformSellers(companyId as string),
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
    sellers: data ?? EMPTY_SELLERS,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
