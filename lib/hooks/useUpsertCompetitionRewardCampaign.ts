// lib/hooks/useUpsertCompetitionRewardCampaign.ts —
// COMPETITION-REWARDS-V1-B2-EXEC §32/§33. Mutation de criar/editar/publicar
// a campanha de premiação (upsert_competition_reward_campaign). Mesmo
// padrão de useUpdateCompanySettings: erro sanitizado, staleness guard via
// getQueryCacheGeneration, retry 0, zero optimistic update.
//
// SEM optimistic update: a UI só reflete o servidor quando o refetch do
// mês invalidado retorna (onSuccess). Isso garante §36 ("dados locais
// refletem response/fetch atual") sem duplicar o estado do editor aqui.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { upsertRewardCampaign, type UpsertRewardCampaignInput, type UpsertRewardCampaignResult } from '@/lib/competitionRewards/repository';
import { CompetitionRewardError } from '@/lib/competitionRewards/errors';

export type UseUpsertCompetitionRewardCampaignOptions = {
  userId?: string | null;
  companyId?: string | null;
  // Resolvido pelo chamador: canManageCompetitionRewards(currentUser).
  writeAuthorized: boolean;
};

export type UseUpsertCompetitionRewardCampaignResult = {
  upsertCampaign: (input: UpsertRewardCampaignInput) => Promise<UpsertRewardCampaignResult>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useUpsertCompetitionRewardCampaign(
  options: UseUpsertCompetitionRewardCampaignOptions,
): UseUpsertCompetitionRewardCampaignResult {
  const { userId, companyId, writeAuthorized } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { result: UpsertRewardCampaignResult; capturedCompanyId: string; monthStart: string },
    unknown,
    UpsertRewardCampaignInput
  >({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity = writeAuthorized
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== '';
      if (!hasIdentity) {
        throw new CompetitionRewardError('reward_campaign_identity_invalid', { operation: 'upsert_competition_reward_campaign' });
      }
      const capturedCompanyId = companyId as string;
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const result = await upsertRewardCampaign(input);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new CompetitionRewardError('reward_campaign_identity_invalid', { operation: 'upsert_competition_reward_campaign' });
      }
      return { result, capturedCompanyId, monthStart: input.monthStart };
    },
    onSuccess: ({ capturedCompanyId, monthStart }) => {
      // §33 — atualiza a config do mês editado…
      queryClient.invalidateQueries({
        queryKey: competitionRewardQueryKeys.campaign(capturedCompanyId, monthStart),
      });
      // …e a authority da competição atual (Home Seller nasce em B3).
      queryClient.invalidateQueries({
        queryKey: competitionRewardQueryKeys.overviewPrefix(capturedCompanyId),
      });
      // NÃO invalida leaderboard: prêmio não altera rank.
    },
  });

  return {
    upsertCampaign: async (input) => (await mutation.mutateAsync(input)).result,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
