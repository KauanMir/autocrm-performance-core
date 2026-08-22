// lib/hooks/useSales.ts — leitura remota de Sales (COMMERCIAL-REMOTE-
// SALES-A2). Mesmo padrão exato de lib/hooks/useDeals.ts.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) —
// este hook não importa AuthService. Rules of Hooks: useQuery é chamado
// SEMPRE, na mesma ordem, com `enabled` fazendo o gating.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS
// (sales_select) é a autoridade de isolamento; o companyId aparece apenas
// na query key, para particionar o cache por empresa. Com modo
// sale_remote_ready, erro remoto NUNCA cai para Sales locais (sem mistura
// de fontes, sem initialData/placeholderData locais).
//
// Dado canônico é RAW — a queryFn NÃO adapta: retorna RemoteSaleRow[] tal
// como veio do banco. A conversão para RemoteSaleModel[]
// (lib/sales/adapter.ts) acontece fora deste hook.
import { useQuery } from '@tanstack/react-query';
import { resolveSalesRemoteMode } from '@/lib/sales/remoteSalesMode';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';
import { fetchVisibleSaleRows } from '@/lib/sales/remoteRepository';
import type { RemoteSaleRow } from '@/lib/sales/adapter';

export type UseSalesOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseSalesResult = {
  saleRemoteMode: ReturnType<typeof resolveSalesRemoteMode>;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  rows: readonly RemoteSaleRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=
// false, zero requests) — mesmo padrão de DISABLED_DEALS_QUERY_KEY.
const DISABLED_SALES_QUERY_KEY = ['company', null, 'sales', 'disabled'] as const;

const EMPTY_SALE_ROWS: readonly RemoteSaleRow[] = Object.freeze([]);

export function useSales(options: UseSalesOptions): UseSalesResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const saleRemoteMode = resolveSalesRemoteMode();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    saleRemoteMode === 'sale_remote_ready' &&
    Boolean(userId) &&
    hasCompany &&
    userIsActive &&
    isManagerOrSeller;

  const queryKey = hasCompany
    ? salesQueryKeys.active(companyId as string)
    : DISABLED_SALES_QUERY_KEY;

  // Declarada SEMPRE (modo não sale_remote_ready ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders — nada de
  // staleTime/retry aqui (mesmos valores aprovados para deals/tasks/
  // visits/leads/pipeline stages).
  const query = useQuery<RemoteSaleRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchVisibleSaleRows,
  });

  const rows = query.data ?? EMPTY_SALE_ROWS;

  return {
    saleRemoteMode,
    queryEnabled,
    queryKey,
    rows,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(query.data && query.data.length === 0),
    hasData: Boolean(query.data && query.data.length > 0),
    refetch: query.refetch,
  };
}
