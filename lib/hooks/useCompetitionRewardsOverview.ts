// lib/hooks/useCompetitionRewardsOverview.ts — COMPETITION-REWARDS-V1-B3-EXEC
// §1/§37. Autoridade ÚNICA da premiação da competição ATUAL na Home
// (get_competition_rewards_overview): campanha publicada + tiers + my_rank
// + my_reward + first_place_reward + last_result, numa só query. Mesmo
// molde estrutural de useCompanySellerLeaderboard: identidade por
// parâmetro, useQuery SEMPRE na mesma ordem, `enabled` gateando, gate
// mestre isRemoteLeadsEnabled(). NÃO usa a RPC de configuração do Manager
// (get_competition_reward_campaign) — essa é só do editor de B2.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { fetchRewardsOverview } from '@/lib/competitionRewards/homeRepository';
import type { RewardsOverview } from '@/lib/competitionRewards/homeTypes';

export type UseCompetitionRewardsOverviewOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
  // true SOMENTE quando companyId vem de um OperationalCompanyContext em
  // modo super_admin → a RPC recebe p_company_id explícito
  // (can_access_company já autoriza no backend).
  isSuperAdminContext?: boolean;
};

export type CompetitionRewardsOverviewState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; overview: RewardsOverview };

const DISABLED_QUERY_KEY = ['company', null, 'competition-rewards-overview', 'v1', null] as const;

export function useCompetitionRewardsOverview(
  options: UseCompetitionRewardsOverviewOptions,
): CompetitionRewardsOverviewState {
  const { userId, companyId, membershipRole, userIsActive, isSuperAdminContext = false } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller' || isSuperAdminContext;

  const queryEnabled = remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller;

  const queryKey = hasCompany && hasUser
    ? competitionRewardQueryKeys.overview(companyId as string, userId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<RewardsOverview>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchRewardsOverview({
      companyId: isSuperAdminContext ? (companyId ?? undefined) : undefined,
    }),
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', overview: query.data };
}
