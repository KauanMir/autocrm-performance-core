// lib/competitionRewards/homeRepository.ts — COMPETITION-REWARDS-V1-B3-EXEC
// §1/§25/§57. Único caminho de leitura da experiência de premiação
// (Home/histórico) e do acknowledge. Usa EXCLUSIVAMENTE as RPCs já
// existentes — nenhuma consulta direta a competition_reward_campaigns /
// competition_months / competition_month_rows. Renderizar rewards NUNCA
// dispara mutation de negócio (§57): estas funções só chamam as 3 RPCs
// abaixo.
import { supabase } from '@/lib/supabase/client';
import { CompetitionRewardError, isCompetitionRewardError, mapCompetitionRewardRpcError } from '@/lib/competitionRewards/errors';
import { adaptRewardsOverview, adaptRewardHistory, type RewardsOverview, type HistoryMonth } from '@/lib/competitionRewards/homeTypes';

export type FetchRewardsOverviewInput = {
  // Enviado SOMENTE no modo Super Admin contextual (companyId explícito da
  // URL /company/[id]). Manager/Seller nunca enviam — a RPC deriva a
  // empresa da própria membership.
  companyId?: string;
};

export async function fetchRewardsOverview(input: FetchRewardsOverviewInput = {}): Promise<RewardsOverview> {
  const { data, error } = await supabase.rpc('get_competition_rewards_overview', {
    p_company_id: input.companyId,
  });
  if (error) throw mapCompetitionRewardRpcError(error, 'get_competition_rewards_overview');
  try {
    return adaptRewardsOverview(data);
  } catch (adapterError) {
    if (isCompetitionRewardError(adapterError)) throw adapterError;
    throw new CompetitionRewardError('reward_overview_fetch_failed', {});
  }
}

export type FetchRewardHistoryInput = {
  companyId?: string;
  limit?: number;
};

export async function fetchRewardHistory(input: FetchRewardHistoryInput = {}): Promise<HistoryMonth[]> {
  const { data, error } = await supabase.rpc('list_competition_reward_history', {
    p_company_id: input.companyId,
    p_limit: input.limit,
  });
  if (error) throw mapCompetitionRewardRpcError(error, 'list_competition_reward_history');
  try {
    return adaptRewardHistory(data);
  } catch (adapterError) {
    if (isCompetitionRewardError(adapterError)) throw adapterError;
    throw new CompetitionRewardError('reward_history_fetch_failed', {});
  }
}

export type AcknowledgeMonthResultInput = {
  competitionMonthId: string;
};

// Retorna o número de linhas afetadas (0 = já reconhecida / não é do
// Seller). Idempotente por design no backend (§24).
export async function acknowledgeMonthResult(input: AcknowledgeMonthResultInput): Promise<number> {
  const { data, error } = await supabase.rpc('acknowledge_competition_month_result', {
    p_competition_month_id: input.competitionMonthId,
  });
  if (error) throw mapCompetitionRewardRpcError(error, 'acknowledge_competition_month_result');
  return typeof data === 'number' ? data : 0;
}
