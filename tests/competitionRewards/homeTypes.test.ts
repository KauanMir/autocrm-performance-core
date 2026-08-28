// COMPETITION-REWARDS-V1-B3-EXEC §31/§32/§34/§52/§54/§55 — adapters do JSON
// de get_competition_rewards_overview e list_competition_reward_history.
// Fixtures espelham EXATAMENTE o shape das RPCs (migration 20260829100000).
// Tolerância: campo estranho/ausente → null / lista vazia, NUNCA throw.
import { describe, expect, it } from 'vitest';
import { adaptRewardsOverview, adaptRewardHistory } from '@/lib/competitionRewards/homeTypes';

const OVERVIEW = {
  company_id: 'co-1',
  current_month: {
    month_start: '2026-08-01',
    period_start: '2026-08-01T03:00:00+00:00',
    period_end: '2026-09-01T03:00:00+00:00',
    campaign: {
      id: 'camp-1',
      status: 'published',
      title: 'Disputa de Agosto',
      total_amount_cents: 175000,
      tiers: [
        { position: 2, amount_cents: 50000, reward_text: null },
        { position: 1, amount_cents: 100000, reward_text: '1 dia de folga' },
        { position: 3, amount_cents: 25000, reward_text: null },
      ],
    },
    my_rank: 2,
    my_reward: { amount_cents: 50000, reward_text: null },
    first_place_reward: { amount_cents: 100000, reward_text: '1 dia de folga' },
  },
  last_result: {
    competition_month_id: 'cm-7',
    month_start: '2026-07-01',
    had_competition: true,
    rank: 1,
    sale_count: 12,
    completed_visit_count: 8,
    scheduled_visit_count: 21,
    reward_amount_cents: 100000,
    reward_text: null,
  },
};

describe('adaptRewardsOverview', () => {
  it('shape completo: campanha publicada + tiers ordenados + my/first reward + last_result', () => {
    const o = adaptRewardsOverview(OVERVIEW as never);
    expect(o.monthStart).toBe('2026-08-01');
    expect(o.campaign?.status).toBe('published');
    expect(o.campaign?.title).toBe('Disputa de Agosto');
    expect(o.campaign?.tiers.map((t) => t.position)).toEqual([1, 2, 3]); // §34-ish: reordenado
    expect(o.myRank).toBe(2);
    expect(o.myReward).toEqual({ amountCents: 50000, rewardText: null });
    expect(o.firstPlaceReward).toEqual({ amountCents: 100000, rewardText: '1 dia de folga' });
    expect(o.lastResult).toMatchObject({ competitionMonthId: 'cm-7', rank: 1, saleCount: 12, rewardAmountCents: 100000 });
  });

  it('overview vazio ({}) → tudo null', () => {
    const o = adaptRewardsOverview({} as never);
    expect(o).toEqual({ monthStart: null, campaign: null, myRank: null, myReward: null, firstPlaceReward: null, lastResult: null });
  });

  it('campanha draft é preservada como draft (o consumidor filtra por status — §4)', () => {
    const o = adaptRewardsOverview({ current_month: { month_start: '2026-08-01', campaign: { ...OVERVIEW.current_month.campaign, status: 'draft' }, my_rank: null, my_reward: null, first_place_reward: null } } as never);
    expect(o.campaign?.status).toBe('draft');
  });

  it('my_reward com ambos null → null (nunca "R$ 0")', () => {
    const o = adaptRewardsOverview({ current_month: { month_start: '2026-08-01', campaign: null, my_rank: 4, my_reward: { amount_cents: null, reward_text: null }, first_place_reward: null } } as never);
    expect(o.myReward).toBeNull();
    expect(o.myRank).toBe(4);
  });

  it('JSON estranho não lança: campos inválidos viram null', () => {
    const o = adaptRewardsOverview({ current_month: { month_start: 42, campaign: 'oops', my_rank: 'x' }, last_result: [] } as never);
    expect(o.monthStart).toBeNull();
    expect(o.campaign).toBeNull();
    expect(o.myRank).toBeNull();
    expect(o.lastResult).toBeNull();
  });

  it('tiers com amount_cents float são descartados (defensivo)', () => {
    const o = adaptRewardsOverview({ current_month: { month_start: '2026-08-01', campaign: { id: 'c', status: 'published', title: null, total_amount_cents: 0, tiers: [{ position: 1, amount_cents: 10.5, reward_text: null }, { position: 2, amount_cents: 20000, reward_text: null }] }, my_rank: null, my_reward: null, first_place_reward: null } } as never);
    expect(o.campaign?.tiers).toEqual([{ position: 1, amountCents: null, rewardText: null }, { position: 2, amountCents: 20000, rewardText: null }]);
  });
});

const HISTORY = [
  {
    competition_month_id: 'cm-8',
    month_start: '2026-08-01',
    had_competition: true,
    campaign: { title: 'Agosto' },
    rows: [
      { seller_id: 's2', seller_name: 'Fernanda', rank: 2, sale_count: 10, completed_visit_count: 11, scheduled_visit_count: 18, reward_amount_cents: 50000, reward_text: null },
      { seller_id: 's1', seller_name: 'Lucas', rank: 1, sale_count: 12, completed_visit_count: 8, scheduled_visit_count: 21, reward_amount_cents: 100000, reward_text: null },
    ],
  },
  {
    competition_month_id: 'cm-9',
    month_start: '2026-09-01',
    had_competition: false,
    campaign: { title: null },
    rows: [],
  },
];

describe('adaptRewardHistory', () => {
  it('meses ordenados desc; rows ordenadas por rank; snapshot preservado (§31/§32)', () => {
    const months = adaptRewardHistory(HISTORY as never);
    expect(months.map((mm) => mm.monthStart)).toEqual(['2026-09-01', '2026-08-01']);
    const aug = months.find((mm) => mm.monthStart === '2026-08-01')!;
    expect(aug.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(aug.rows[0]).toEqual({
      sellerId: 's1', sellerName: 'Lucas', rank: 1,
      saleCount: 12, completedVisitCount: 8, scheduledVisitCount: 21,
      rewardAmountCents: 100000, rewardText: null,
    });
    expect(aug.title).toBe('Agosto');
  });

  it('mês had_competition=false → rows vazio (§28)', () => {
    const months = adaptRewardHistory(HISTORY as never);
    const sep = months.find((mm) => mm.monthStart === '2026-09-01')!;
    expect(sep.hadCompetition).toBe(false);
    expect(sep.rows).toEqual([]);
  });

  it('não-array ([] do backend p/ SA global) → []', () => {
    expect(adaptRewardHistory([] as never)).toEqual([]);
    expect(adaptRewardHistory({} as never)).toEqual([]);
    expect(adaptRewardHistory(null as never)).toEqual([]);
  });
});
