// Testes de useCurrentCompanySellerLabels (M1-E, E3-A1).
// Mock isolado de lib/supabase/client (rpc) e mock controlável de
// isRemoteLeadsEnabled. Nenhuma rede real, nenhum SellerService, nenhum
// StoreAdapter — este hook não importa nenhum dos dois.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCurrentCompanySellerLabels,
  type UseCurrentCompanySellerLabelsOptions,
} from '@/lib/hooks/useCurrentCompanySellerLabels';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled };
});

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function baseOptions(
  overrides: Partial<UseCurrentCompanySellerLabelsOptions> = {},
): UseCurrentCompanySellerLabelsOptions {
  return {
    userId: 'user-1',
    companyId: 'company-a',
    membershipRole: 'manager',
    userIsActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.isRemoteLeadsEnabled.mockReset();
  mocks.isRemoteLeadsEnabled.mockReturnValue(true);
});

describe('useCurrentCompanySellerLabels — gating', () => {
  it('Manager com membership ativa monta a query', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ seller_id: 's1', name: 'Ana' }], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentCompanySellerLabels(baseOptions()), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.queryEnabled).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('list_current_company_seller_labels');
  });

  it('Seller com membership ativa monta a query', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ seller_id: 's1', name: 'Ana' }], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ membershipRole: 'seller' })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.queryEnabled).toBe(true);
  });

  it('Super Admin (membershipRole null/ausente) nunca monta a query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ membershipRole: null })),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem membership ativa (companyId ausente) não monta a query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ companyId: null })),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('usuário inativo não monta a query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ userIsActive: false })),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('flag REMOTE_LEADS desativada não monta a query', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentCompanySellerLabels(baseOptions()), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.remoteLeadsEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem userId não monta a query', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ userId: null })),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCurrentCompanySellerLabels — chave de cache e isolamento', () => {
  it('queryKey inclui companyId e identityKey (userId)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ userId: 'user-9', companyId: 'company-z' })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.queryKey).toEqual(['company', 'company-z', 'seller-labels', 'remote', 'user-9']);
  });

  it('dois Sellers da mesma empresa não compartilham cache (chaves distintas por userId)', async () => {
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: [{ seller_id: 's-own', name: 'Eu' }], error: null }));
    const { wrapper } = createWrapper();
    const { result: seller1 } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ membershipRole: 'seller', userId: 'seller-1' })),
      { wrapper },
    );
    const { result: seller2 } = renderHook(
      () => useCurrentCompanySellerLabels(baseOptions({ membershipRole: 'seller', userId: 'seller-2' })),
      { wrapper },
    );
    await waitFor(() => expect(seller1.current.hasData).toBe(true));
    await waitFor(() => expect(seller2.current.hasData).toBe(true));
    expect(seller1.current.queryKey).not.toEqual(seller2.current.queryKey);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('troca de empresa (A → B) não reaproveita cache: nova chave, nova chamada', async () => {
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: [{ seller_id: 's1', name: 'Ana' }], error: null }));
    const { wrapper, queryClient } = createWrapper();
    const { result, rerender } = renderHook(
      (opts: UseCurrentCompanySellerLabelsOptions) => useCurrentCompanySellerLabels(opts),
      { wrapper, initialProps: baseOptions({ companyId: 'company-a' }) },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    const keyA = result.current.queryKey;

    rerender(baseOptions({ companyId: 'company-b' }));
    await waitFor(() => expect(result.current.queryKey).not.toEqual(keyA));
    expect(queryClient.getQueryData(keyA as unknown[])).not.toBe(
      queryClient.getQueryData(result.current.queryKey as unknown[]),
    );
  });
});

describe('useCurrentCompanySellerLabels — estados e sellersById', () => {
  it('sucesso: sellerLabels e sellersById refletem o retorno real (sem placeholder)', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { seller_id: 's1', name: 'Ana' },
        { seller_id: 's2', name: 'Bruno' },
      ],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentCompanySellerLabels(baseOptions()), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.sellersById).toEqual({
      s1: { id: 's1', name: 'Ana' },
      s2: { id: 's2', name: 'Bruno' },
    });
  });

  it('lista vazia ⇒ isEmpty true, hasData false, sellersById vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentCompanySellerLabels(baseOptions()), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.sellersById).toEqual({});
  });

  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentCompanySellerLabels(baseOptions()), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.sellerLabels).toEqual([]);
    expect(result.current.sellersById).toEqual({});
  });
});
