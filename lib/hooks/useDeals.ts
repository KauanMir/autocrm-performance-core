// lib/hooks/useDeals.ts — leitura remota de Deals
// (COMMERCIAL-REMOTE-DEALS-B2-A). Ainda NÃO consumido por nenhuma
// tela/componente.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) —
// este hook não importa AuthService. Rules of Hooks: useQuery é chamado
// SEMPRE, na mesma ordem, com `enabled` fazendo o gating. Mesmo padrão
// exato de lib/hooks/useVisits.ts/lib/hooks/useTasks.ts.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS
// (deals_select) é a autoridade de isolamento; o companyId aparece apenas
// na query key, para particionar o cache por empresa. Com modo
// deal_remote_ready, erro remoto NUNCA cai para Deals locais (sem mistura
// de fontes, sem initialData/placeholderData locais).
//
// Dado canônico é RAW — a queryFn NÃO adapta: retorna RemoteDealRow[] tal
// como veio do banco. A conversão para RemoteDealModel[]
// (lib/deals/adapter.ts) acontece fora deste hook.
import { useQuery } from '@tanstack/react-query';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { fetchVisibleDealRows } from '@/lib/deals/remoteRepository';
import type { RemoteDealRow } from '@/lib/deals/adapter';

export type UseDealsOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseDealsResult = {
  dealRemoteMode: ReturnType<typeof resolveDealRemoteMode>;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  rows: readonly RemoteDealRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=
// false, zero requests) — mesmo padrão de DISABLED_VISITS_QUERY_KEY/
// DISABLED_TASKS_QUERY_KEY.
const DISABLED_DEALS_QUERY_KEY = ['company', null, 'deals', 'disabled'] as const;

const EMPTY_DEAL_ROWS: readonly RemoteDealRow[] = Object.freeze([]);

export function useDeals(options: UseDealsOptions): UseDealsResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const dealRemoteMode = resolveDealRemoteMode();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    dealRemoteMode === 'deal_remote_ready' &&
    Boolean(userId) &&
    hasCompany &&
    userIsActive &&
    isManagerOrSeller;

  const queryKey = hasCompany
    ? dealQueryKeys.active(companyId as string)
    : DISABLED_DEALS_QUERY_KEY;

  // Declarada SEMPRE (modo não deal_remote_ready ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders — nada de
  // staleTime/retry aqui (mesmos valores aprovados para tasks/visits/leads/
  // pipeline stages).
  const query = useQuery<RemoteDealRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchVisibleDealRows,
  });

  const rows = query.data ?? EMPTY_DEAL_ROWS;

  return {
    dealRemoteMode,
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
