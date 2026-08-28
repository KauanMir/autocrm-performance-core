// lib/competitionRewards/homeTypes.ts — COMPETITION-REWARDS-V1-B3-EXEC
// §1/§17/§25/§31. Adapters TOLERANTES do JSON de
// get_competition_rewards_overview (migration 20260829100000) e
// list_competition_reward_history. "Tolerante" = campo ausente/estranho
// vira null / lista vazia, NUNCA um throw — a Home não pode derrubar
// Pódio/Ranking por causa de um problema no bloco de premiação (§40).
// Nunca reconstrói prêmio a partir de tiers atuais: o histórico usa
// exclusivamente reward_amount_cents / reward_text do snapshot (§31).
import type { Json } from '@/lib/supabase/database.types';

export type RewardStatus = 'draft' | 'published';

export interface RewardRef {
  amountCents: number | null;
  rewardText: string | null;
}

export interface OverviewTier {
  position: number;
  amountCents: number | null;
  rewardText: string | null;
}

export interface OverviewCampaign {
  id: string;
  status: RewardStatus;
  title: string | null;
  totalAmountCents: number;
  tiers: OverviewTier[];
}

export interface LastResult {
  competitionMonthId: string;
  monthStart: string;
  hadCompetition: boolean;
  rank: number;
  saleCount: number;
  completedVisitCount: number;
  scheduledVisitCount: number;
  rewardAmountCents: number | null;
  rewardText: string | null;
}

export interface RewardsOverview {
  monthStart: string | null;
  // Só `published` chega aqui como campanha da equipe (Seller nunca recebe
  // draft do backend; para Manager/SA o consumidor filtra por status — §4).
  campaign: OverviewCampaign | null;
  myRank: number | null;
  myReward: RewardRef | null;
  firstPlaceReward: RewardRef | null;
  lastResult: LastResult | null;
}

export interface HistoryRow {
  sellerId: string;
  sellerName: string;
  rank: number;
  saleCount: number;
  completedVisitCount: number;
  scheduledVisitCount: number;
  rewardAmountCents: number | null;
  rewardText: string | null;
}

export interface HistoryMonth {
  competitionMonthId: string;
  monthStart: string;
  hadCompetition: boolean;
  title: string | null;
  rows: HistoryRow[];
}

// ── helpers tolerantes ──────────────────────────────────────────────────
function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}
function intOr0(value: unknown): number {
  return int(value) ?? 0;
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
function bool(value: unknown): boolean {
  return value === true;
}
function rewardRef(value: unknown): RewardRef | null {
  const r = rec(value);
  if (!r) return null;
  const amountCents = int(r.amount_cents);
  const rewardText = str(r.reward_text);
  if (amountCents === null && rewardText === null) return null;
  return { amountCents, rewardText };
}

function adaptTier(raw: unknown): OverviewTier | null {
  const r = rec(raw);
  if (!r) return null;
  const position = int(r.position);
  if (position === null || position < 1 || position > 10) return null;
  const amountCents = int(r.amount_cents);
  const rewardText = str(r.reward_text);
  return { position, amountCents, rewardText };
}

function adaptCampaign(raw: unknown): OverviewCampaign | null {
  const r = rec(raw);
  if (!r) return null;
  const id = str(r.id);
  const status = r.status === 'published' ? 'published' : r.status === 'draft' ? 'draft' : null;
  if (id === null || status === null) return null;
  const tiers = Array.isArray(r.tiers)
    ? (r.tiers.map(adaptTier).filter((t): t is OverviewTier => t !== null)).sort((a, b) => a.position - b.position)
    : [];
  return {
    id,
    status,
    title: str(r.title),
    totalAmountCents: intOr0(r.total_amount_cents),
    tiers,
  };
}

function adaptLastResult(raw: unknown): LastResult | null {
  const r = rec(raw);
  if (!r) return null;
  const competitionMonthId = str(r.competition_month_id);
  const monthStart = str(r.month_start);
  const rank = int(r.rank);
  if (competitionMonthId === null || monthStart === null || rank === null) return null;
  return {
    competitionMonthId,
    monthStart,
    hadCompetition: bool(r.had_competition),
    rank,
    saleCount: intOr0(r.sale_count),
    completedVisitCount: intOr0(r.completed_visit_count),
    scheduledVisitCount: intOr0(r.scheduled_visit_count),
    rewardAmountCents: int(r.reward_amount_cents),
    rewardText: str(r.reward_text),
  };
}

export function adaptRewardsOverview(json: Json): RewardsOverview {
  const root = rec(json) ?? {};
  const cm = rec(root.current_month) ?? {};
  return {
    monthStart: str(cm.month_start),
    campaign: adaptCampaign(cm.campaign),
    myRank: int(cm.my_rank),
    myReward: rewardRef(cm.my_reward),
    firstPlaceReward: rewardRef(cm.first_place_reward),
    lastResult: adaptLastResult(root.last_result),
  };
}

function adaptHistoryRow(raw: unknown): HistoryRow | null {
  const r = rec(raw);
  if (!r) return null;
  const sellerId = str(r.seller_id);
  const rank = int(r.rank);
  if (sellerId === null || rank === null) return null;
  return {
    sellerId,
    sellerName: str(r.seller_name) ?? '—',
    rank,
    saleCount: intOr0(r.sale_count),
    completedVisitCount: intOr0(r.completed_visit_count),
    scheduledVisitCount: intOr0(r.scheduled_visit_count),
    rewardAmountCents: int(r.reward_amount_cents),
    rewardText: str(r.reward_text),
  };
}

function adaptHistoryMonth(raw: unknown): HistoryMonth | null {
  const r = rec(raw);
  if (!r) return null;
  const competitionMonthId = str(r.competition_month_id);
  const monthStart = str(r.month_start);
  if (competitionMonthId === null || monthStart === null) return null;
  const rows = Array.isArray(r.rows)
    ? r.rows.map(adaptHistoryRow).filter((x): x is HistoryRow => x !== null).sort((a, b) => a.rank - b.rank)
    : [];
  return {
    competitionMonthId,
    monthStart,
    hadCompetition: bool(r.had_competition),
    title: str(rec(r.campaign)?.title),
    rows,
  };
}

export function adaptRewardHistory(json: Json): HistoryMonth[] {
  if (!Array.isArray(json)) return [];
  return json
    .map(adaptHistoryMonth)
    .filter((m): m is HistoryMonth => m !== null)
    .sort((a, b) => (a.monthStart < b.monthStart ? 1 : a.monthStart > b.monthStart ? -1 : 0));
}
