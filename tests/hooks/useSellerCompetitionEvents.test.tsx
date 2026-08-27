// Testes de useSellerCompetitionEvents (PODIUM-COMPETITION-R2B-B1-EXEC).
// Supabase RPC mockado, mesmo padrão estrutural de
// tests/hooks/useCompanySellerLeaderboard.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSellerCompetitionEvents } from '@/lib/hooks/useSellerCompetitionEvents';

const m = vi.hoisted(() => ({ rpc: vi.fn(), isRemoteLeadsEnabled: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled };
});

function rpcRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1', event_type: 'rank_up', source_type: 'sale', old_rank: 4, new_rank: 3, sale_count: 3,
    related_seller_id: 's2', related_seller_label: 'Ana Souza',
    competition_started: false, period_start: '2026-08-01T00:00:00Z', period_end: '2026-09-01T00:00:00Z',
    created_at: '2026-08-10T12:00:00Z', ...over,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: [rpcRow()], error: null });
  m.isRemoteLeadsEnabled.mockReturnValue(true);
});

describe('useSellerCompetitionEvents — flag OFF', () => {
  it('status local, nenhuma chamada RPC', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('local');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useSellerCompetitionEvents — gating por papel (§21/§32 do EXEC)', () => {
  it('Manager: unavailable, nenhuma chamada (nunca recebe comemoracao pessoal)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'manager', userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('Super Admin (membershipRole null): unavailable, nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: null, membershipRole: null, userIsActive: true }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('userIsActive=false: unavailable, nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: false }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useSellerCompetitionEvents — sucesso', () => {
  it('Seller: chama list_my_unseen_competition_events e mapeia snake_case -> camelCase', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ id: 'evt-9', source_type: 'visit', old_rank: 4, new_rank: 1, sale_count: 5, related_seller_id: null, related_seller_label: null, competition_started: true })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledWith('list_my_unseen_competition_events');
    expect(result.current.status === 'ready' && result.current.events).toEqual([{
      id: 'evt-9', eventType: 'rank_up', sourceType: 'visit', oldRank: 4, newRank: 1, saleCount: 5,
      relatedSellerId: null, relatedSellerLabel: null, competitionStarted: true,
      periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', createdAt: '2026-08-10T12:00:00Z',
    }]);
  });

  it('COMPETITION-V2 §14 — source_type=appointment mapeia para sourceType=appointment (sale/visit intactos)', async () => {
    m.rpc.mockResolvedValue({
      data: [
        rpcRow({ id: 'evt-a', source_type: 'appointment', old_rank: 3, new_rank: 2 }),
        rpcRow({ id: 'evt-s', source_type: 'sale' }),
        rpcRow({ id: 'evt-v', source_type: 'visit' }),
        rpcRow({ id: 'evt-x', source_type: 'something_novo_futuro' }),
      ],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const events = result.current.status === 'ready' ? result.current.events : [];
    expect(events.map((e) => e.sourceType)).toEqual(['appointment', 'sale', 'visit', 'sale']);
  });

  it('nenhum evento unseen: ready com array vazio, nunca erro', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.events).toEqual([]);
  });
});

describe('useSellerCompetitionEvents — erro', () => {
  it('erro do Supabase e exposto, retry disponivel', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSellerCompetitionEvents({ userId: 'u1', companyId: 'c1', membershipRole: 'seller', userIsActive: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status === 'error' && typeof result.current.retry).toBe('function');
  });
});
