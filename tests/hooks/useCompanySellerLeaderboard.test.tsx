// Testes de useCompanySellerLeaderboard (PODIUM-COMPETITION-R1-EXEC).
// Supabase RPC mockado (rpc), QueryClient novo por teste. Mesmo padrão
// estrutural de tests/hooks/useActiveCompanyIdentity.test.tsx — só o
// shape do retorno e o cascade de período mudam.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompanySellerLeaderboard, companySellerLeaderboardQueryKey } from '@/lib/hooks/useCompanySellerLeaderboard';
import type { ResolvedPeriod } from '@/lib/date/companyPeriod';

const m = vi.hoisted(() => ({ rpc: vi.fn(), isRemoteLeadsEnabled: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: m.isRemoteLeadsEnabled };
});

const READY_PERIOD: ResolvedPeriod = { kind: 'ready', startMillis: 1735689600000, endMillis: 1738368000000 };

function rpcRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    seller_id: 's1', seller_label: 'Lucas Martins', sale_count: 3, completed_visit_count: 1, rank: 1,
    movement_positions_gained: null, movement_happened_at: null,
    ...over,
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

describe('useCompanySellerLeaderboard — flag OFF', () => {
  it('status local, nenhuma chamada RPC', () => {
    m.isRemoteLeadsEnabled.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    expect(result.current.status).toBe('local');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useCompanySellerLeaderboard — gating', () => {
  it('membershipRole null (Super Admin sem company context): unavailable, nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: null, membershipRole: null, userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('userIsActive=false: unavailable, nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: false, period: READY_PERIOD }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useCompanySellerLeaderboard — cascade de período (nunca filtra sem timezone real)', () => {
  it('period.kind loading: status loading, nenhuma chamada RPC', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: { kind: 'loading' } }),
      { wrapper },
    );
    expect(result.current.status).toBe('loading');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('period.kind unavailable: status unavailable, nenhuma chamada RPC', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: { kind: 'unavailable' } }),
      { wrapper },
    );
    expect(result.current.status).toBe('unavailable');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('period.kind error: status error com o mesmo retry, nenhuma chamada RPC', () => {
    const retry = vi.fn();
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: { kind: 'error', retry } }),
      { wrapper },
    );
    expect(result.current.status).toBe('error');
    expect(result.current.status === 'error' && result.current.retry).toBe(retry);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('useCompanySellerLeaderboard — sucesso', () => {
  it('Manager: chama a RPC com boundaries ISO e sem p_company_id (deriva da propria membership)', async () => {
    const { wrapper } = createWrapper();
    renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(m.rpc).toHaveBeenCalled());
    const [fnName, payload] = m.rpc.mock.calls[0];
    expect(fnName).toBe('list_company_seller_leaderboard');
    expect(payload.p_period_start).toBe(new Date(READY_PERIOD.startMillis).toISOString());
    expect(payload.p_period_end).toBe(new Date(READY_PERIOD.endMillis).toISOString());
    expect(payload.p_company_id).toBeUndefined();
  });

  it('Seller: mesma RPC, mesmo shape (nenhuma ampliacao/filtro adicional aqui — autoridade e a RPC)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-2', companyId: 'company-1', membershipRole: 'seller', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledWith('list_company_seller_leaderboard', expect.any(Object));
  });

  it('ready: mapeia snake_case -> camelCase (sellerId/sellerLabel/saleCount/completedVisitCount/rank)', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ seller_id: 's9', seller_label: 'Bianca Alves', sale_count: 5, completed_visit_count: 2, rank: 2 })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.rows).toEqual([
      { sellerId: 's9', sellerLabel: 'Bianca Alves', saleCount: 5, completedVisitCount: 2, rank: 2, movement: null },
    ]);
  });

  // PODIUM-MOVEMENT-R1-B1-EXEC — movement_positions_gained/
  // movement_happened_at (null quando não há evento elegível no mês
  // oficial) viram um único campo de domínio `movement`.
  it('ready: movement presente vira { positionsGained, happenedAt }', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ movement_positions_gained: 2, movement_happened_at: '2026-08-10T12:00:00Z' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const rows = result.current.status === 'ready' ? result.current.rows : [];
    expect(rows[0].movement).toEqual({ positionsGained: 2, happenedAt: '2026-08-10T12:00:00Z' });
  });

  it('ready: movement ausente (null/null) vira movement=null, nunca 0 nem objeto parcial', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ movement_positions_gained: null, movement_happened_at: null })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const rows = result.current.status === 'ready' ? result.current.rows : [];
    expect(rows[0].movement).toBeNull();
  });

  it('empty: TODAS as linhas com saleCount=0 (roster ativo sem nenhuma venda) vira status empty com sellerCount real', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ seller_id: 's1', sale_count: 0, completed_visit_count: 0 }), rpcRow({ seller_id: 's2', sale_count: 0, completed_visit_count: 1, rank: 2 })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.status === 'empty' && result.current.sellerCount).toBe(2);
  });

  it('ready: pelo menos 1 seller com saleCount>0 nunca vira empty, mesmo com outros em 0', async () => {
    m.rpc.mockResolvedValue({
      data: [rpcRow({ seller_id: 's1', sale_count: 3, rank: 1 }), rpcRow({ seller_id: 's2', sale_count: 0, rank: 2 })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.rows).toHaveLength(2);
  });

  it('roster vazio (nenhum seller ativo): rows vazio nunca vira empty (sellerCount 0 nao tem sentido de "aguardando vendas")', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    expect(result.current.status).toBe('ready');
    expect(result.current.status === 'ready' && result.current.rows).toEqual([]);
  });
});

describe('useCompanySellerLeaderboard — erro', () => {
  it('erro do Supabase e exposto, retry disponivel', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period: READY_PERIOD }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status === 'error' && typeof result.current.retry).toBe('function');
  });
});

describe('useCompanySellerLeaderboard — query key própria por período', () => {
  it('companySellerLeaderboardQueryKey inclui companyId/userId/boundaries — troca de período gera key diferente', async () => {
    expect(companySellerLeaderboardQueryKey('company-1', 'user-1', 1000, 2000)).toEqual(
      ['company', 'company-1', 'seller-leaderboard', 'remote', 'user-1', 1000, 2000],
    );
    expect(companySellerLeaderboardQueryKey('company-1', 'user-1', 1000, 2000))
      .not.toEqual(companySellerLeaderboardQueryKey('company-1', 'user-1', 1000, 3000));
  });

  it('trocar o período (boundaries diferentes) refaz a busca (nova query key)', async () => {
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ period }: { period: ResolvedPeriod }) => useCompanySellerLeaderboard({ userId: 'user-1', companyId: 'company-1', membershipRole: 'manager', userIsActive: true, period }),
      { wrapper, initialProps: { period: READY_PERIOD } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(m.rpc).toHaveBeenCalledTimes(1);

    const otherPeriod: ResolvedPeriod = { kind: 'ready', startMillis: 1, endMillis: 2 };
    rerender({ period: otherPeriod });
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
    const [, secondPayload] = m.rpc.mock.calls[1];
    expect(secondPayload.p_period_start).toBe(new Date(1).toISOString());
    expect(secondPayload.p_period_end).toBe(new Date(2).toISOString());
  });
});
