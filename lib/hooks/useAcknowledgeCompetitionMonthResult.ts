// lib/hooks/useAcknowledgeCompetitionMonthResult.ts —
// COMPETITION-REWARDS-V1-B3-EXEC §22/§23/§24/§38. Seller confirma o
// resultado final do mês (acknowledge_competition_month_result). Sem
// optimistic hide: o card só some quando o refetch do overview confirma
// que last_result virou null (§23 — nunca esconder otimisticamente sem
// rollback). Idempotente no backend (§24); o cliente ainda desabilita o
// botão enquanto pending. onSuccess invalida SÓ o overview de premiação —
// NUNCA leaderboard (§57, prêmio não mexe em rank).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { acknowledgeMonthResult } from '@/lib/competitionRewards/homeRepository';
import { CompetitionRewardError } from '@/lib/competitionRewards/errors';

export type UseAcknowledgeCompetitionMonthResultOptions = {
  userId?: string | null;
  companyId?: string | null;
  // Resolvido pelo chamador: o card só é renderizado para um Seller com
  // last_result pendente.
  enabled: boolean;
};

export type UseAcknowledgeCompetitionMonthResultResult = {
  acknowledge: (competitionMonthId: string) => Promise<number>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
};

export function useAcknowledgeCompetitionMonthResult(
  options: UseAcknowledgeCompetitionMonthResultOptions,
): UseAcknowledgeCompetitionMonthResultResult {
  const { userId, companyId, enabled } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<number, unknown, string>({
    retry: 0,
    mutationFn: async (competitionMonthId) => {
      const hasIdentity = enabled
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && typeof competitionMonthId === 'string' && competitionMonthId.trim() !== '';
      if (!hasIdentity) {
        throw new CompetitionRewardError('reward_campaign_identity_invalid', { operation: 'acknowledge_competition_month_result' });
      }
      const generationAtStart = getQueryCacheGeneration(queryClient);
      const affected = await acknowledgeMonthResult({ competitionMonthId });
      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new CompetitionRewardError('reward_campaign_identity_invalid', { operation: 'acknowledge_competition_month_result' });
      }
      return affected;
    },
    onSuccess: () => {
      if (typeof companyId === 'string' && companyId.trim() !== '') {
        queryClient.invalidateQueries({ queryKey: competitionRewardQueryKeys.overviewPrefix(companyId) });
      }
    },
  });

  return {
    acknowledge: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
