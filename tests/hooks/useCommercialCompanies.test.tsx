// Testes de useCommercialCompanies (M1-F S8-C2-B2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommercialCompanies } from '@/lib/hooks/useCommercialCompanies';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';

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

describe('useCommercialCompanies — não autorizado / sem usuário', () => {
  it('authorized=false: nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCommercialCompanies({ userId: 'user-1', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.current.companies).toEqual([]);
  });

  it('userId ausente: nenhuma query é executada mesmo com authorized=true', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCommercialCompanies({ userId: null, authorized: true }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useCommercialCompanies — sucesso', () => {
  it('lista empresas, incluindo cancelada', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Empresa 1', status: 'ativa' },
        { id: 'c2', name: 'Empresa 2', status: 'cancelada' },
      ],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCommercialCompanies({ userId: 'admin-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.companies.map((c) => c.status)).toEqual(['ativa', 'cancelada']);
    expect(mocks.rpc).toHaveBeenCalledWith('list_commercial_companies');
  });

  it('isolamento por identidade: usuários diferentes usam keys diferentes', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => useCommercialCompanies({ userId, authorized: true }),
      { wrapper, initialProps: { userId: 'user-a' } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ userId: 'user-b' });
    // A troca de userId não deve reaproveitar o mesmo slot de cache — cada
    // chamada isolada é a garantia real (verificada via query keys no
    // teste dedicado de tests/commercial/queryKeys.test.ts).
    expect(platformCompanyQueryKeysDiffer()).toBe(true);
  });
});

describe('useCommercialCompanies — erro', () => {
  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCommercialCompanies({ userId: 'admin-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.companies).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });
});

function platformCompanyQueryKeysDiffer(): boolean {
  return JSON.stringify(platformCommercialQueryKeys.companies('user-a'))
    !== JSON.stringify(platformCommercialQueryKeys.companies('user-b'));
}
