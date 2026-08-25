// Testes de useMarkCompetitionEventsSeen (PODIUM-COMPETITION-R2B-B1-EXEC).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMarkCompetitionEventsSeen } from '@/lib/hooks/useMarkCompetitionEventsSeen';
import { sellerCompetitionEventsQueryKey } from '@/lib/hooks/useSellerCompetitionEvents';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
});

describe('useMarkCompetitionEventsSeen', () => {
  it('chama mark_competition_events_seen com os ids fornecidos', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMarkCompetitionEventsSeen({ companyId: 'c1', userId: 'u1' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.markSeen(['evt-1', 'evt-2']);
    });
    expect(m.rpc).toHaveBeenCalledWith('mark_competition_events_seen', { p_event_ids: ['evt-1', 'evt-2'] });
  });

  it('array vazio: nunca chama a RPC (guarda client-side, além do backend)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMarkCompetitionEventsSeen({ companyId: 'c1', userId: 'u1' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.markSeen([]);
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('sucesso: invalida sellerCompetitionEventsQueryKey (proximo fetch nao repete o evento)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useMarkCompetitionEventsSeen({ companyId: 'c1', userId: 'u1' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.markSeen(['evt-1']);
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: sellerCompetitionEventsQueryKey('c1', 'u1'),
    }));
  });

  it('erro do Supabase e propagado (caller decide como tratar)', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMarkCompetitionEventsSeen({ companyId: 'c1', userId: 'u1' }),
      { wrapper },
    );
    await expect(result.current.markSeen(['evt-1'])).rejects.toBeTruthy();
  });
});
