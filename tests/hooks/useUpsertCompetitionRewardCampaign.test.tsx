// COMPETITION-REWARDS-V1-B2-EXEC §32/§33/§57 — useUpsertCompetitionRewardCampaign.
// Verifica o PAYLOAD exato enviado a upsert_competition_reward_campaign
// (status, month_start = 1º dia, amount_cents integer, position 1..N
// sequencial derivada do índice) e a invalidação de cache (campaign do mês
// + overview; NUNCA leaderboard).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpsertCompetitionRewardCampaign } from '@/lib/hooks/useUpsertCompetitionRewardCampaign';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, Wrapper };
}

const ROW = {
  id: 'camp-1', month_start: '2026-09-01', status: 'draft',
  title: null, published_at: null, updated_at: '2026-08-01T10:00:00+00:00',
};

const OPTS = { userId: 'u-mgr', companyId: 'co-a', writeAuthorized: true };

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: ROW, error: null });
});

describe('payload', () => {
  it('draft: status=draft, month_start=1º dia, title null quando vazio', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useUpsertCompetitionRewardCampaign(OPTS), { wrapper: Wrapper });
    await result.current.upsertCampaign({
      monthStart: '2026-09-01',
      status: 'draft',
      title: null,
      tiers: [{ amountCents: 100000, rewardText: null }],
    });
    expect(m.rpc).toHaveBeenCalledWith('upsert_competition_reward_campaign', {
      p_month_start: '2026-09-01',
      p_status: 'draft',
      p_title: null,
      p_tiers: [{ position: 1, amount_cents: 100000, reward_text: null }],
    });
  });

  it('publish: status=published; positions 1..N derivadas do índice (Manager nunca digita position)', async () => {
    m.rpc.mockResolvedValue({ data: { ...ROW, status: 'published', published_at: '2026-08-01T10:00:00+00:00' }, error: null });
    const { Wrapper } = setup();
    const { result } = renderHook(() => useUpsertCompetitionRewardCampaign(OPTS), { wrapper: Wrapper });
    await result.current.upsertCampaign({
      monthStart: '2026-09-01',
      status: 'published',
      title: 'Prêmios',
      tiers: [
        { amountCents: 100000, rewardText: null },
        { amountCents: null, rewardText: 'Folga' },
        { amountCents: 25000, rewardText: 'Bônus' },
      ],
    });
    const [, args] = m.rpc.mock.calls[0];
    expect(args.p_status).toBe('published');
    expect(args.p_tiers).toEqual([
      { position: 1, amount_cents: 100000, reward_text: null },
      { position: 2, amount_cents: null, reward_text: 'Folga' },
      { position: 3, amount_cents: 25000, reward_text: 'Bônus' },
    ]);
    for (const t of args.p_tiers) {
      if (t.amount_cents !== null) expect(Number.isInteger(t.amount_cents)).toBe(true);
    }
  });

  it('published edit: chamador manda status=published de novo (sem caminho unpublish no hook)', async () => {
    m.rpc.mockResolvedValue({ data: { ...ROW, status: 'published' }, error: null });
    const { Wrapper } = setup();
    const { result } = renderHook(() => useUpsertCompetitionRewardCampaign(OPTS), { wrapper: Wrapper });
    await result.current.upsertCampaign({
      monthStart: '2026-08-01', status: 'published', title: 'x',
      tiers: [{ amountCents: 50000, rewardText: null }],
    });
    expect(m.rpc.mock.calls[0][1].p_status).toBe('published');
  });
});

describe('gating + cache', () => {
  it('writeAuthorized=false → erro local, RPC não chamada', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(
      () => useUpsertCompetitionRewardCampaign({ ...OPTS, writeAuthorized: false }),
      { wrapper: Wrapper },
    );
    await expect(result.current.upsertCampaign({
      monthStart: '2026-09-01', status: 'draft', title: null, tiers: [{ amountCents: 100, rewardText: null }],
    })).rejects.toMatchObject({ code: 'reward_campaign_identity_invalid' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('§33 — onSuccess invalida campaign(mês) + overview; NUNCA leaderboard', async () => {
    const { Wrapper, invalidateSpy } = setup();
    const { result } = renderHook(() => useUpsertCompetitionRewardCampaign(OPTS), { wrapper: Wrapper });
    await result.current.upsertCampaign({
      monthStart: '2026-09-01', status: 'draft', title: null, tiers: [{ amountCents: 100000, rewardText: null }],
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['company', 'co-a', 'competition-reward-campaign', '2026-09-01']));
    expect(keys).toContain(JSON.stringify(['company', 'co-a', 'competition-rewards-overview']));
    expect(keys.some((k) => k.includes('leaderboard'))).toBe(false);
  });

  it('erro do backend é mapeado (month_closed)', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'month_closed' } });
    const { Wrapper } = setup();
    const { result } = renderHook(() => useUpsertCompetitionRewardCampaign(OPTS), { wrapper: Wrapper });
    await expect(result.current.upsertCampaign({
      monthStart: '2026-07-01', status: 'draft', title: null, tiers: [{ amountCents: 100, rewardText: null }],
    })).rejects.toMatchObject({ code: 'reward_campaign_month_closed' });
  });
});
