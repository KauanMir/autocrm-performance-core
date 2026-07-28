// Testes de usePlatformLeadTimeline (M1-F S8-C2-B2). Supabase mockado (rpc).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlatformLeadTimeline } from '@/lib/hooks/usePlatformLeadTimeline';

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

describe('usePlatformLeadTimeline — gating', () => {
  it('companyId ou leadId ausente: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result: r1 } = renderHook(() => usePlatformLeadTimeline({ companyId: null, leadId: 'lead-1', authorized: true }), { wrapper });
    const { result: r2 } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: null, authorized: true }), { wrapper });
    expect(r1.current.queryEnabled).toBe(false);
    expect(r2.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('authorized=false: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('usePlatformLeadTimeline — sucesso', () => {
  it('busca com os parâmetros exatos e devolve as entradas ordenadas pela RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: 't1', occurred_at: '2026-07-20T10:00:00Z' }],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_lead_timeline', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
    });
    expect(result.current.entries).toEqual([{ id: 't1', occurred_at: '2026-07-20T10:00:00Z' }]);
  });

  it('leads diferentes usam caches diferentes — nunca cruzam', async () => {
    mocks.rpc.mockImplementation((_fn: string, args?: { p_lead_id: string }) =>
      Promise.resolve({ data: args ? [{ id: `timeline-of-${args.p_lead_id}` }] : [], error: null }));
    const { wrapper } = createWrapper();
    const { result: t1 } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    const { result: t2 } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: 'lead-2', authorized: true }), { wrapper });
    await waitFor(() => expect(t1.current.hasData).toBe(true));
    await waitFor(() => expect(t2.current.hasData).toBe(true));
    expect(t1.current.entries).toEqual([{ id: 'timeline-of-lead-1' }]);
    expect(t2.current.entries).toEqual([{ id: 'timeline-of-lead-2' }]);
  });
});

describe('usePlatformLeadTimeline — erro', () => {
  it('erro (inclusive lead_not_found de outra empresa) é exposto, nunca lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_not_found' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlatformLeadTimeline({ companyId: 'company-a', leadId: 'lead-de-outra-empresa', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.entries).toEqual([]);
  });
});
