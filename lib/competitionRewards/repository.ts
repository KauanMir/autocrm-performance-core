// lib/competitionRewards/repository.ts — COMPETITION-REWARDS-V1-B2-EXEC
// §1/§32. Único caminho de leitura/escrita da configuração de premiação.
// Sem React, sem cache — payload TypeScript → RPC Supabase → modelo.
//
// Contratos (autoridade: lib/supabase/database.types.ts + os corpos das
// RPCs em supabase/migrations/20260829100000_competition_rewards_v1.sql e
// 20260831100000_competition_reward_campaign_config_read.sql):
//   get_competition_reward_campaign(p_month_start date, p_company_id uuid?)
//     -> Json  { month_start, campaign: null | {...tiers...} }
//   upsert_competition_reward_campaign(p_month_start date, p_status text,
//     p_title text, p_tiers jsonb) -> competition_reward_campaigns row
//
// Nenhuma das duas recebe company_id da UI: Manager sempre deriva a empresa
// da própria membership no backend. O editor NUNCA lê via
// get_competition_rewards_overview (§1).
import { supabase } from '@/lib/supabase/client';
import {
  CompetitionRewardError,
  isCompetitionRewardError,
  mapCompetitionRewardRpcError,
} from '@/lib/competitionRewards/errors';
import {
  adaptRewardCampaignConfig,
  type RewardCampaignConfigModel,
  type RewardCampaignStatus,
} from '@/lib/competitionRewards/adapter';

export type FetchRewardCampaignConfigInput = {
  // 'YYYY-MM-01'
  monthStart: string;
};

export async function fetchRewardCampaignConfig(
  input: FetchRewardCampaignConfigInput,
): Promise<RewardCampaignConfigModel> {
  const { data, error } = await supabase.rpc('get_competition_reward_campaign', {
    p_month_start: input.monthStart,
  });

  if (error) throw mapCompetitionRewardRpcError(error, 'get_competition_reward_campaign');

  try {
    return adaptRewardCampaignConfig(data);
  } catch (adapterError) {
    if (isCompetitionRewardError(adapterError)) throw adapterError;
    throw new CompetitionRewardError('reward_campaign_contract_invalid', {});
  }
}

export type UpsertRewardTierInput = {
  amountCents: number | null;
  rewardText: string | null;
};

export type UpsertRewardCampaignInput = {
  monthStart: string;
  status: RewardCampaignStatus;
  title: string | null;
  // Ordem = colocação. A posição 1..N é derivada do índice aqui — o
  // Manager nunca digita position (§13/§14).
  tiers: readonly UpsertRewardTierInput[];
};

export type UpsertRewardCampaignResult = {
  id: string;
  monthStart: string;
  status: RewardCampaignStatus;
  title: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

export async function upsertRewardCampaign(
  input: UpsertRewardCampaignInput,
): Promise<UpsertRewardCampaignResult> {
  const pTiers = input.tiers.map((tier, index) => ({
    position: index + 1,
    // integer ou null — NUNCA float (§16).
    amount_cents: tier.amountCents,
    reward_text: tier.rewardText,
  }));

  const { data, error } = await supabase.rpc('upsert_competition_reward_campaign', {
    p_month_start: input.monthStart,
    p_status: input.status,
    p_title: input.title,
    p_tiers: pTiers,
  });

  if (error) throw mapCompetitionRewardRpcError(error, 'upsert_competition_reward_campaign');
  if (!data) throw new CompetitionRewardError('reward_campaign_mutation_failed', {});

  const row = data as {
    id: string; month_start: string; status: string;
    title: string | null; published_at: string | null; updated_at: string;
  };
  return {
    id: row.id,
    monthStart: row.month_start,
    status: row.status === 'published' ? 'published' : 'draft',
    title: row.title,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}
