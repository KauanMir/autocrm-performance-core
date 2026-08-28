// lib/hooks/useCompetitionRewardHistory.ts — COMPETITION-REWARDS-V1-B3-EXEC
// §25/§29/§30/§37. Histórico de premiações (list_competition_reward_history)
// — SOMENTE meses que tiveram campanha publicada; nunca inventa meses. Uso:
// Manager em Ajustes → Competição (standings completos) e Seller na Home
// (própria linha + Top 3, já filtrado pelo backend). `enabled` extra
// (`active`) permite carga LAZY: a Home só dispara a RPC quando o Seller
// abre a seção colapsável (§30).
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { fetchRewardHistory } from '@/lib/competitionRewards/homeRepository';
import type { HistoryMonth } from '@/lib/competitionRewards/homeTypes';

export type UseCompetitionRewardHistoryOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
  isSuperAdminContext?: boolean;
  limit?: number;
  // Carga lazy: false ⇒ a query nunca roda (Seller com a seção fechada).
  active?: boolean;
};

export type CompetitionRewardHistoryState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; months: readonly HistoryMonth[] };

const DISABLED_QUERY_KEY = ['company', null, 'competition-reward-history', 'v1', null, 0] as const;

export function useCompetitionRewardHistory(
  options: UseCompetitionRewardHistoryOptions,
): CompetitionRewardHistoryState {
  const {
    userId, companyId, membershipRole, userIsActive,
    isSuperAdminContext = false, limit = 12, active = true,
  } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller' || isSuperAdminContext;

  const queryEnabled =
    remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller && active;

  const queryKey = hasCompany && hasUser
    ? competitionRewardQueryKeys.history(companyId as string, userId as string, limit)
    : DISABLED_QUERY_KEY;

  const query = useQuery<HistoryMonth[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchRewardHistory({
      companyId: isSuperAdminContext ? (companyId ?? undefined) : undefined,
      limit,
    }),
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };
  return { status: 'ready', months: query.data ?? [] };
}
