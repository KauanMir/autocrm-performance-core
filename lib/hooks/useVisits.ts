// lib/hooks/useVisits.ts — leitura remota de Visits
// (COMMERCIAL-REMOTE-VISITS-B2-A). Ainda NÃO consumido por nenhuma
// tela/componente.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) —
// este hook não importa AuthService. Rules of Hooks: useQuery é chamado
// SEMPRE, na mesma ordem, com `enabled` fazendo o gating. Mesmo padrão
// exato de lib/hooks/useTasks.ts.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS
// (visits_select) é a autoridade de isolamento; o companyId aparece
// apenas na query key, para particionar o cache por empresa. Com modo
// visit_remote_ready, erro remoto NUNCA cai para Visits locais (sem
// mistura de fontes, sem initialData/placeholderData locais).
//
// Dado canônico é RAW — a queryFn NÃO adapta com Lead catalog: retorna
// RemoteVisitRow[] tal como veio do banco. A conversão para
// RemoteVisitModel[] (lib/visits/adapter.ts) acontece fora deste hook.
import { useQuery } from '@tanstack/react-query';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { fetchVisibleVisitRows } from '@/lib/visits/remoteRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';

export type UseVisitsOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseVisitsResult = {
  visitRemoteMode: ReturnType<typeof resolveVisitRemoteMode>;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  rows: readonly RemoteVisitRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=
// false, zero requests) — mesmo padrão de DISABLED_TASKS_QUERY_KEY/
// DISABLED_LEADS_QUERY_KEY.
const DISABLED_VISITS_QUERY_KEY = ['company', null, 'visits', 'disabled'] as const;

const EMPTY_VISIT_ROWS: readonly RemoteVisitRow[] = Object.freeze([]);

export function useVisits(options: UseVisitsOptions): UseVisitsResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const visitRemoteMode = resolveVisitRemoteMode();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    visitRemoteMode === 'visit_remote_ready' &&
    Boolean(userId) &&
    hasCompany &&
    userIsActive &&
    isManagerOrSeller;

  const queryKey = hasCompany
    ? visitQueryKeys.active(companyId as string)
    : DISABLED_VISITS_QUERY_KEY;

  // Declarada SEMPRE (modo não visit_remote_ready ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders — nada de
  // staleTime/retry aqui (mesmos valores aprovados para tasks/leads/
  // pipeline stages).
  const query = useQuery<RemoteVisitRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchVisibleVisitRows,
  });

  const rows = query.data ?? EMPTY_VISIT_ROWS;

  return {
    visitRemoteMode,
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
