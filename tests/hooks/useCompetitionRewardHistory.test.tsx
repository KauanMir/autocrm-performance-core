// COMPETITION-REWARDS-V1-B3-EXEC §25/§30 — useCompetitionRewardHistory.
// Foco: carga LAZY (active=false ⇒ RPC nunca roda) + gating.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompetitionRewardHistory } from '@/lib/hooks/useCompetitionRewardHistory';

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

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  m.isRemoteLeadsEnabled.mockReturnValue(true);
});

it('active=false → status unavailable, RPC nunca chamada (lazy — §30)', async () => {
  const { result } = renderHook(() => useCompetitionRewardHistory({ ...SELLER, active: false }), { wrapper: wrap() });
  expect(result.current.status).toBe('unavailable');
  await new Promise((r) => setTimeout(r, 20));
  expect(m.rpc).not.toHaveBeenCalled();
});

it('active=true → chama list_competition_reward_history com limit', async () => {
  const { result } = renderHook(() => useCompetitionRewardHistory({ ...SELLER, active: true, limit: 6 }), { wrapper: wrap() });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(m.rpc).toHaveBeenCalledWith('list_competition_reward_history', { p_company_id: undefined, p_limit: 6 });
});

it('flag OFF → local', () => {
  m.isRemoteLeadsEnabled.mockReturnValue(false);
  const { result } = renderHook(() => useCompetitionRewardHistory({ ...SELLER, active: true }), { wrapper: wrap() });
  expect(result.current.status).toBe('local');
});

it('Super Admin contextual → envia p_company_id', async () => {
  const { result } = renderHook(
    () => useCompetitionRewardHistory({ ...SELLER, membershipRole: null, isSuperAdminContext: true, active: true }),
    { wrapper: wrap() },
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(m.rpc).toHaveBeenCalledWith('list_competition_reward_history', { p_company_id: 'co', p_limit: 12 });
});

it('ready devolve months adaptados e ordenados desc', async () => {
  m.rpc.mockResolvedValue({
    data: [
      { competition_month_id: 'a', month_start: '2026-07-01', had_competition: true, campaign: { title: null }, rows: [] },
      { competition_month_id: 'b', month_start: '2026-08-01', had_competition: true, campaign: { title: null }, rows: [] },
    ],
    error: null,
  });
  const { result } = renderHook(() => useCompetitionRewardHistory({ ...SELLER, active: true }), { wrapper: wrap() });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') throw new Error('ready');
  expect(result.current.months.map((x) => x.monthStart)).toEqual(['2026-08-01', '2026-07-01']);
});
