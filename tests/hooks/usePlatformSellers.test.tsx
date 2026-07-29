// Testes de usePlatformSellers (M1-F S8-C2-C2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformSellers } from '@/lib/hooks/usePlatformSellers';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => mocks.rpc.mockReset());

describe('usePlatformSellers — gating', () => {
  it('companyId null: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSellers({ companyId: null, authorized: true }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('authorized=false: nenhuma query executada mesmo com companyId (modo somente leitura nunca monta este hook autorizado)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSellers({ companyId: 'company-a', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('usePlatformSellers — sucesso e isolamento', () => {
  it('busca vendedores com p_company_id exato', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ seller_id: 's1', name: 'Vendedor 1' }], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSellers({ companyId: 'company-a', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_sellers_for_company', { p_company_id: 'company-a' });
    expect(result.current.sellers).toEqual([{ seller_id: 's1', name: 'Vendedor 1' }]);
  });

  it('empresa A nunca aparece na leitura da empresa B (cache isolado por companyId — seller_id é identidade por empresa)', async () => {
    mocks.rpc.mockImplementation((_fn: string, args?: { p_company_id: string }) =>
      Promise.resolve({ data: args ? [{ seller_id: `seller-of-${args.p_company_id}`, name: 'V' }] : [], error: null }));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformSellers({ companyId: 'company-a', authorized: true }), { wrapper });
    const { result: b } = renderHook(() => usePlatformSellers({ companyId: 'company-b', authorized: true }), { wrapper });
    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.sellers).toEqual([{ seller_id: 'seller-of-company-a', name: 'V' }]);
    expect(b.current.sellers).toEqual([{ seller_id: 'seller-of-company-b', name: 'V' }]);
  });

  it('lista vazia ⇒ isEmpty true, hasData false', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSellers({ companyId: 'company-a', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });
});

describe('usePlatformSellers — erro', () => {
  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformSellers({ companyId: 'company-x', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.sellers).toEqual([]);
  });
});
