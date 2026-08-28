// lib/competitionRewards/adapter.ts — COMPETITION-REWARDS-V1-B2-EXEC
// §1/§40. Valida e converte o JSON de get_competition_reward_campaign
// (migration 20260831100000) no modelo do editor. Shape real confirmado no
// corpo da RPC e em lib/supabase/database.types.ts (Returns: Json) — NÃO
// inventar campos. Qualquer divergência de contrato vira
// CompetitionRewardError('reward_campaign_contract_invalid'), nunca um
// número/objeto fabricado.
import type { Json } from '@/lib/supabase/database.types';
import { CompetitionRewardError } from '@/lib/competitionRewards/errors';

export type RewardCampaignStatus = 'draft' | 'published';

export interface RewardTierModel {
  position: number;
  amountCents: number | null;
  rewardText: string | null;
}

export interface RewardCampaignModel {
  id: string;
  monthStart: string; // 'YYYY-MM-DD'
  timezone: string;
  status: RewardCampaignStatus;
  title: string | null;
  publishedAt: string | null;
  updatedAt: string;
  // Sempre ORDER BY position ASC (garantido pela RPC; reordenado aqui por
  // segurança).
  tiers: RewardTierModel[];
}

export interface RewardCampaignConfigModel {
  monthStart: string;
  campaign: RewardCampaignModel | null;
}

function bad(field: string): never {
  throw new CompetitionRewardError('reward_campaign_contract_invalid', { message: field });
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad(field);
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') bad(field);
  return value;
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') bad(field);
  return value;
}

function asNullableInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  // bigint amount_cents vem como number no JSON do PostgREST (valores
  // monetários reais ficam muito abaixo de MAX_SAFE_INTEGER).
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) bad(field);
  return value;
}

function adaptTier(raw: unknown): RewardTierModel {
  const rec = asRecord(raw, 'tier');
  const position = rec.position;
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > 10) {
    bad('tier.position');
  }
  return {
    position: position as number,
    amountCents: asNullableInt(rec.amount_cents, 'tier.amount_cents'),
    rewardText: asNullableString(rec.reward_text, 'tier.reward_text'),
  };
}

function adaptCampaign(raw: unknown): RewardCampaignModel {
  const rec = asRecord(raw, 'campaign');
  const status = rec.status;
  if (status !== 'draft' && status !== 'published') bad('campaign.status');

  const tiersRaw = rec.tiers;
  if (!Array.isArray(tiersRaw)) bad('campaign.tiers');
  const tiers = tiersRaw.map(adaptTier).sort((a, b) => a.position - b.position);

  return {
    id: asString(rec.id, 'campaign.id'),
    monthStart: asString(rec.month_start, 'campaign.month_start'),
    timezone: asString(rec.timezone, 'campaign.timezone'),
    status: status as RewardCampaignStatus,
    title: asNullableString(rec.title, 'campaign.title'),
    publishedAt: asNullableString(rec.published_at, 'campaign.published_at'),
    updatedAt: asString(rec.updated_at, 'campaign.updated_at'),
    tiers,
  };
}

export function adaptRewardCampaignConfig(json: Json): RewardCampaignConfigModel {
  const rec = asRecord(json, 'root');
  const monthStart = asString(rec.month_start, 'month_start');
  const campaignRaw = rec.campaign;
  return {
    monthStart,
    campaign: campaignRaw === null || campaignRaw === undefined ? null : adaptCampaign(campaignRaw),
  };
}
