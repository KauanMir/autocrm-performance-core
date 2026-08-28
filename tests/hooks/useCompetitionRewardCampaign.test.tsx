// COMPETITION-REWARDS-V1-B2-EXEC §32/§46/§47/§52/§53 — useCompetitionRewardCampaign.
// Supabase RPC mockado; QueryClient novo por teste. FOCO: Seller/Super
// Admin NUNCA disparam get_competition_reward_campaign; o mês futuro
// recarrega preenchido (o bug que bloqueou B2).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompetitionRewardCampaign } from '@/lib/hooks/useCompetitionRewardCampaign';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const MANAGER = {
  userId: 'u-mgr', companyId: 'co-a', membershipRole: 'manager' as const,
  userIsActive: true, monthStart: '2026-08-01', readAuthorized: true,
};

function campaignJson(over: Record<string, unknown> = {}) {
  return {
    month_start: '2026-08-01',
    campaign: {
      id: 'camp-1', month_start: '2026-08-01', timezone: 'America/Sao_Paulo',
      status: 'draft', title: 'Agosto', published_at: null, updated_at: '2026-07-20T10:00:00+00:00',
      tiers: [{ position: 1, amount_cents: 100000, reward_text: null }],
      ...over,
    },
  };
}

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: { month_start: '2026-08-01', campaign: null }, error: null });
});

describe('gating', () => {
  it('SELLER → unavailable, RPC NUNCA chamada (§46)', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useCompetitionRewardCampaign({ ...MANAGER, membershipRole: 'seller' }),
      { wrapper: Wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    await new Promise((r) => setTimeout(r, 20));
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('readAuthorized=false → unavailable, RPC não chamada', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useCompetitionRewardCampaign({ ...MANAGER, readAuthorized: false }),
      { wrapper: Wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    await new Promise((r) => setTimeout(r, 20));
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('sem monthStart → unavailable', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useCompetitionRewardCampaign({ ...MANAGER, monthStart: null }),
      { wrapper: Wrapper },
    );
    expect(result.current.status).toBe('unavailable');
  });

  it('Manager + mês válido → chama get_competition_reward_campaign com p_month_start', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledWith('get_competition_reward_campaign', { p_month_start: '2026-08-01' });
  });
});

describe('estados', () => {
  it('current sem campanha → ready, config.campaign null', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('esperado ready');
    expect(result.current.config.campaign).toBeNull();
  });

  it('current draft → ready com tiers', async () => {
    m.rpc.mockResolvedValue({ data: campaignJson(), error: null });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('esperado ready');
    expect(result.current.config.campaign?.status).toBe('draft');
    expect(result.current.config.campaign?.tiers).toEqual([{ position: 1, amountCents: 100000, rewardText: null }]);
  });

  it('current published → ready published', async () => {
    m.rpc.mockResolvedValue({ data: campaignJson({ status: 'published', published_at: '2026-07-20T10:00:00+00:00' }), error: null });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('esperado ready');
    expect(result.current.config.campaign?.status).toBe('published');
  });

  it('erro de rede → status error com retry', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('JSON fora do contrato → contract-error', async () => {
    m.rpc.mockResolvedValue({ data: { campaign: null }, error: null }); // falta month_start
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCompetitionRewardCampaign(MANAGER), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe('contract-error'));
  });
});

describe('§53 — mês futuro recarrega preenchido', () => {
  it('trocar monthStart re-consulta a RPC com o novo mês e devolve a campanha salva', async () => {
    m.rpc.mockImplementation((_fn: string, args: { p_month_start: string }) => {
      if (args.p_month_start === '2026-09-01') {
        return Promise.resolve({ data: campaignJson({ month_start: '2026-09-01' }), error: null });
      }
      return Promise.resolve({ data: { month_start: args.p_month_start, campaign: null }, error: null });
    });

    const { Wrapper } = wrapper();
    const { result, rerender } = renderHook(
      (props: { monthStart: string }) => useCompetitionRewardCampaign({ ...MANAGER, monthStart: props.monthStart }),
      { wrapper: Wrapper, initialProps: { monthStart: '2026-08-01' } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('ready esperado');
    expect(result.current.config.campaign).toBeNull(); // agosto vazio

    rerender({ monthStart: '2026-09-01' });
    await waitFor(() => {
      if (result.current.status !== 'ready') return expect(false).toBe(true);
      expect(result.current.config.campaign?.tiers[0].amountCents).toBe(100000);
    });
    expect(m.rpc).toHaveBeenCalledWith('get_competition_reward_campaign', { p_month_start: '2026-09-01' });
  });
});
