// COMPETITION-REWARDS-V1-B2-EXEC §1/§40/§46 (RPC CONTRACT TEST) — o shape
// dos fixtures espelha EXATAMENTE get_competition_reward_campaign
// (migration 20260831100000): { month_start, campaign: null | { id,
// month_start, timezone, status, title, published_at, updated_at, tiers:[
// { position, amount_cents, reward_text } ] } }.
import { describe, expect, it } from 'vitest';
import { adaptRewardCampaignConfig } from '@/lib/competitionRewards/adapter';
import { isCompetitionRewardError } from '@/lib/competitionRewards/errors';

const EMPTY = { month_start: '2026-09-01', campaign: null };

const PUBLISHED = {
  month_start: '2026-08-01',
  campaign: {
    id: 'camp-1',
    month_start: '2026-08-01',
    timezone: 'America/Sao_Paulo',
    status: 'published',
    title: 'Campanha de Agosto',
    published_at: '2026-07-20T10:00:00+00:00',
    updated_at: '2026-07-21T10:00:00+00:00',
    tiers: [
      { position: 1, amount_cents: 100000, reward_text: null },
      { position: 2, amount_cents: null, reward_text: 'Folga' },
      { position: 3, amount_cents: 25000, reward_text: 'Bônus' },
    ],
  },
};

describe('adaptRewardCampaignConfig — shape válido', () => {
  it('campanha inexistente → campaign null', () => {
    const model = adaptRewardCampaignConfig(EMPTY as never);
    expect(model).toEqual({ monthStart: '2026-09-01', campaign: null });
  });

  it('campanha publicada com 3 tiers (money / text / combined)', () => {
    const model = adaptRewardCampaignConfig(PUBLISHED as never);
    expect(model.monthStart).toBe('2026-08-01');
    expect(model.campaign).toMatchObject({
      id: 'camp-1',
      monthStart: '2026-08-01',
      timezone: 'America/Sao_Paulo',
      status: 'published',
      title: 'Campanha de Agosto',
      publishedAt: '2026-07-20T10:00:00+00:00',
      updatedAt: '2026-07-21T10:00:00+00:00',
    });
    expect(model.campaign?.tiers).toEqual([
      { position: 1, amountCents: 100000, rewardText: null },
      { position: 2, amountCents: null, rewardText: 'Folga' },
      { position: 3, amountCents: 25000, rewardText: 'Bônus' },
    ]);
  });

  it('draft com title null', () => {
    const model = adaptRewardCampaignConfig({
      month_start: '2026-09-01',
      campaign: { ...PUBLISHED.campaign, status: 'draft', title: null, published_at: null },
    } as never);
    expect(model.campaign?.status).toBe('draft');
    expect(model.campaign?.title).toBeNull();
    expect(model.campaign?.publishedAt).toBeNull();
  });

  it('§8 — tiers fora de ordem no JSON são reordenados por position ASC', () => {
    const model = adaptRewardCampaignConfig({
      month_start: '2026-08-01',
      campaign: {
        ...PUBLISHED.campaign,
        tiers: [
          { position: 3, amount_cents: 25000, reward_text: 'Bônus' },
          { position: 1, amount_cents: 100000, reward_text: null },
          { position: 2, amount_cents: null, reward_text: 'Folga' },
        ],
      },
    } as never);
    expect(model.campaign?.tiers.map((t) => t.position)).toEqual([1, 2, 3]);
  });

  it('amount_cents é sempre integer (§46)', () => {
    const model = adaptRewardCampaignConfig(PUBLISHED as never);
    for (const t of model.campaign!.tiers) {
      if (t.amountCents !== null) expect(Number.isInteger(t.amountCents)).toBe(true);
    }
  });
});

describe('adaptRewardCampaignConfig — contrato violado', () => {
  const throwsContractInvalid = (json: unknown) => {
    try {
      adaptRewardCampaignConfig(json as never);
      return false;
    } catch (err) {
      return isCompetitionRewardError(err) && err.code === 'reward_campaign_contract_invalid';
    }
  };

  it('root não-objeto', () => {
    expect(throwsContractInvalid(null)).toBe(true);
    expect(throwsContractInvalid('nope')).toBe(true);
    expect(throwsContractInvalid([])).toBe(true);
  });
  it('sem month_start', () => {
    expect(throwsContractInvalid({ campaign: null })).toBe(true);
  });
  it('status inesperado', () => {
    expect(throwsContractInvalid({ month_start: '2026-08-01', campaign: { ...PUBLISHED.campaign, status: 'archived' } })).toBe(true);
  });
  it('tiers não-array', () => {
    expect(throwsContractInvalid({ month_start: '2026-08-01', campaign: { ...PUBLISHED.campaign, tiers: {} } })).toBe(true);
  });
  it('amount_cents float', () => {
    expect(throwsContractInvalid({
      month_start: '2026-08-01',
      campaign: { ...PUBLISHED.campaign, tiers: [{ position: 1, amount_cents: 100.5, reward_text: null }] },
    })).toBe(true);
  });
  it('position fora de 1..10', () => {
    expect(throwsContractInvalid({
      month_start: '2026-08-01',
      campaign: { ...PUBLISHED.campaign, tiers: [{ position: 0, amount_cents: 100, reward_text: null }] },
    })).toBe(true);
  });
});
