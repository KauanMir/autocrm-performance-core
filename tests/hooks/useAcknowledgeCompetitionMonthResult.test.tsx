// COMPETITION-REWARDS-V1-B3-EXEC §22/§24/§38/§57 —
// useAcknowledgeCompetitionMonthResult. Payload correto, invalida SÓ o
// overview (nunca leaderboard), guard de identidade.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAcknowledgeCompetitionMonthResult } from '@/lib/hooks/useAcknowledgeCompetitionMonthResult';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: m.rpc }, isSupabaseConfigured: true }));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidateSpy, Wrapper };
}

const OPTS = { userId: 'u', companyId: 'co', enabled: true };

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
});

it('chama acknowledge_competition_month_result com o competition_month_id', async () => {
  const { Wrapper } = setup();
  const { result } = renderHook(() => useAcknowledgeCompetitionMonthResult(OPTS), { wrapper: Wrapper });
  const affected = await result.current.acknowledge('cm-7');
  expect(affected).toBe(1);
  expect(m.rpc).toHaveBeenCalledWith('acknowledge_competition_month_result', { p_competition_month_id: 'cm-7' });
});

it('idempotente: backend devolve 0 na segunda vez, sem erro', async () => {
  m.rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: 0, error: null });
  const { Wrapper } = setup();
  const { result } = renderHook(() => useAcknowledgeCompetitionMonthResult(OPTS), { wrapper: Wrapper });
  await result.current.acknowledge('cm-7');
  await expect(result.current.acknowledge('cm-7')).resolves.toBe(0);
});

it('onSuccess invalida o overview de premiação e NUNCA leaderboard (§57)', async () => {
  const { Wrapper, invalidateSpy } = setup();
  const { result } = renderHook(() => useAcknowledgeCompetitionMonthResult(OPTS), { wrapper: Wrapper });
  await result.current.acknowledge('cm-7');
  await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
  const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
  expect(keys).toContain(JSON.stringify(['company', 'co', 'competition-rewards-overview']));
  expect(keys.some((k) => k.includes('leaderboard'))).toBe(false);
});

it('enabled=false ou sem identidade → erro local, RPC não chamada', async () => {
  const { Wrapper } = setup();
  const { result } = renderHook(() => useAcknowledgeCompetitionMonthResult({ ...OPTS, enabled: false }), { wrapper: Wrapper });
  await expect(result.current.acknowledge('cm-7')).rejects.toMatchObject({ code: 'reward_campaign_identity_invalid' });
  expect(m.rpc).not.toHaveBeenCalled();
});

it('erro do backend (forbidden) é mapeado', async () => {
  m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
  const { Wrapper } = setup();
  const { result } = renderHook(() => useAcknowledgeCompetitionMonthResult(OPTS), { wrapper: Wrapper });
  await expect(result.current.acknowledge('cm-7')).rejects.toMatchObject({ code: 'reward_campaign_forbidden' });
});
