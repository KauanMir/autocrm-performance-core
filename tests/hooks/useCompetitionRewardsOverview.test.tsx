// COMPETITION-REWARDS-V1-B3-EXEC §1/§37/§51 — useCompetitionRewardsOverview.
// Supabase RPC mockado; QueryClient novo por teste.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompetitionRewardsOverview } from '@/lib/hooks/useCompetitionRewardsOverview';

const m = vi.hoisted(() => ({ rpc: vi.fn(), isRemoteLeadsEnabled: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: m.rpc }, isSupabaseConfigured: true }));
vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled };
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const SELLER = { userId: 'u', companyId: 'co', membershipRole: 'seller' as const, userIsActive: true };

function overviewJson() {
  return {
    company_id: 'co',
    current_month: { month_start: '2026-08-01', campaign: null, my_rank: 2, my_reward: null, first_place_reward: null },
    last_result: null,
  };
}

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: overviewJson(), error: null });
  m.isRemoteLeadsEnabled.mockReturnValue(true);
});

it('flag OFF → status local, RPC nunca chamada', () => {
  m.isRemoteLeadsEnabled.mockReturnValue(false);
  const { result } = renderHook(() => useCompetitionRewardsOverview(SELLER), { wrapper: wrap() });
  expect(result.current.status).toBe('local');
  expect(m.rpc).not.toHaveBeenCalled();
});

it('sem role (Super Admin global) → unavailable, RPC não chamada', async () => {
  const { result } = renderHook(
    () => useCompetitionRewardsOverview({ ...SELLER, membershipRole: null }),
    { wrapper: wrap() },
  );
  expect(result.current.status).toBe('unavailable');
  await new Promise((r) => setTimeout(r, 20));
  expect(m.rpc).not.toHaveBeenCalled();
});

it('Seller/Manager → chama get_competition_rewards_overview sem p_company_id', async () => {
  const { result } = renderHook(() => useCompetitionRewardsOverview(SELLER), { wrapper: wrap() });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(m.rpc).toHaveBeenCalledWith('get_competition_rewards_overview', { p_company_id: undefined });
});

it('Super Admin contextual → envia p_company_id', async () => {
  const { result } = renderHook(
    () => useCompetitionRewardsOverview({ ...SELLER, membershipRole: null, isSuperAdminContext: true }),
    { wrapper: wrap() },
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(m.rpc).toHaveBeenCalledWith('get_competition_rewards_overview', { p_company_id: 'co' });
});

it('ready expõe o overview adaptado', async () => {
  const { result } = renderHook(() => useCompetitionRewardsOverview(SELLER), { wrapper: wrap() });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') throw new Error('ready');
  expect(result.current.overview.myRank).toBe(2);
  expect(result.current.overview.campaign).toBeNull();
});

it('erro de RPC → status error com retry', async () => {
  m.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
  const { result } = renderHook(() => useCompetitionRewardsOverview(SELLER), { wrapper: wrap() });
  await waitFor(() => expect(result.current.status).toBe('error'));
});
