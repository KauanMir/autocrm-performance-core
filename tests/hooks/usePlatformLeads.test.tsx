// Testes de usePlatformLeads (M1-F S8-C2-B2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformLeads } from '@/lib/hooks/usePlatformLeads';

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

describe('usePlatformLeads — gating', () => {
  it('companyId null: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeads({ companyId: null, archived: false, authorized: true }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('authorized=false: nenhuma query executada mesmo com companyId', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeads({ companyId: 'company-a', archived: false, authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('usePlatformLeads — sucesso e isolamento', () => {
  it('busca ativos (archived=false) com os parâmetros exatos', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'lead-1' }], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeads({ companyId: 'company-a', archived: false, authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', {
      p_company_id: 'company-a',
      p_archived: false,
    });
  });

  it('archived=true busca a lista de arquivados separadamente (key diferente)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result: active } = renderHook(() => usePlatformLeads({ companyId: 'company-a', archived: false, authorized: true }), { wrapper });
    const { result: archived } = renderHook(() => usePlatformLeads({ companyId: 'company-a', archived: true, authorized: true }), { wrapper });
    await waitFor(() => expect(active.current.isLoading).toBe(false));
    await waitFor(() => expect(archived.current.isLoading).toBe(false));
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', { p_company_id: 'company-a', p_archived: false });
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', { p_company_id: 'company-a', p_archived: true });
  });

  it('empresa A nunca aparece na leitura da empresa B (cache isolado por companyId)', async () => {
    mocks.rpc.mockImplementation((_fn: string, args?: { p_company_id: string }) =>
      Promise.resolve({ data: args ? [{ id: `lead-of-${args.p_company_id}` }] : [], error: null }));
    const { wrapper } = createWrapper();
    const { result: a } = renderHook(() => usePlatformLeads({ companyId: 'company-a', archived: false, authorized: true }), { wrapper });
    const { result: b } = renderHook(() => usePlatformLeads({ companyId: 'company-b', archived: false, authorized: true }), { wrapper });
    await waitFor(() => expect(a.current.hasData).toBe(true));
    await waitFor(() => expect(b.current.hasData).toBe(true));
    expect(a.current.leads).toEqual([{ id: 'lead-of-company-a' }]);
    expect(b.current.leads).toEqual([{ id: 'lead-of-company-b' }]);
  });
});

describe('usePlatformLeads — erro', () => {
  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'company_not_found' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeads({ companyId: 'company-x', archived: false, authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.leads).toEqual([]);
  });
});
