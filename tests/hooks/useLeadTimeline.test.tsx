// Testes de useLeadTimeline (M1-E, E7-B2-A1). Supabase mockado (from/select/
// eq/eq/order chain — leitura direta via RLS, sem RPC própria).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeadTimeline } from '@/lib/hooks/useLeadTimeline';
import { leadQueryKeys } from '@/lib/leads/queryKeys';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function mockReadResponse(response: { data: unknown; error: unknown }) {
  const order3 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order2 = vi.fn(() => ({ order: order3 }));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq2 = vi.fn(() => ({ order: order1 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  mocks.from.mockReturnValue({ select });
  return { select, eq1, eq2 };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe('useLeadTimeline — gating', () => {
  it('companyId ou leadId ausente: nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result: r1 } = renderHook(() => useLeadTimeline({ companyId: null, leadId: 'lead-1', authorized: true }), { wrapper });
    const { result: r2 } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: null, authorized: true }), { wrapper });
    expect(r1.current.queryEnabled).toBe(false);
    expect(r2.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('authorized=false (modo local/remote_misconfigured/sem identidade operacional): nenhuma query executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('nunca lê a tabela profiles nem chama RPC', async () => {
    mockReadResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(mocks.from).not.toHaveBeenCalledWith('profiles');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useLeadTimeline — sucesso', () => {
  it('usa a query key leadQueryKeys.timeline(companyId, leadId) e devolve as entradas adaptadas', async () => {
    mockReadResponse({
      data: [{ id: 't1', company_id: 'company-a', lead_id: 'lead-1', actor_profile_id: 'p1', icon: 'phone', color: '#27C75F', label: 'Ligação', detail: null, occurred_at: '2026-07-31T10:00:00Z', created_at: '2026-07-31T10:00:00Z' }],
      error: null,
    });
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });

    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.entries).toEqual([{
      id: 't1', leadId: 'lead-1', icon: 'phone', color: '#27C75F', label: 'Ligação', detail: null,
      occurredAt: '2026-07-31T10:00:00Z', createdAt: '2026-07-31T10:00:00Z',
    }]);
    // Nunca companyId/actorProfileId no modelo de apresentação.
    expect(result.current.entries[0]).not.toHaveProperty('companyId');
    expect(result.current.entries[0]).not.toHaveProperty('actorProfileId');
    expect(queryClient.getQueryData(leadQueryKeys.timeline('company-a', 'lead-1'))).toBeTruthy();
  });

  it('leads diferentes usam caches diferentes — nunca cruzam', async () => {
    mocks.from.mockImplementation(() => {
      const order3 = vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null }));
      const order2 = vi.fn(() => ({ order: order3 }));
      const order1 = vi.fn(() => ({ order: order2 }));
      const eq2 = vi.fn(() => ({ order: order1 }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      return { select: vi.fn(() => ({ eq: eq1 })) };
    });
    const { wrapper, queryClient } = createWrapper();
    renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-2', authorized: true }), { wrapper });
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData(leadQueryKeys.timeline('company-a', 'lead-1'))).not.toBe(
      queryClient.getQueryData(leadQueryKeys.timeline('company-a', 'lead-2')),
    );
  });

  it('lista vazia: isEmpty true, hasData false', async () => {
    mockReadResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
  });
});

describe('useLeadTimeline — erro e retry', () => {
  it('erro do Supabase é exposto, nunca lista vazia silenciosa', async () => {
    mockReadResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.entries).toEqual([]);
  });

  it('refetch dispara nova consulta', async () => {
    const spies = mockReadResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLeadTimeline({ companyId: 'company-a', leadId: 'lead-1', authorized: true }), { wrapper });
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    spies.select.mockClear();
    result.current.refetch();
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
  });
});
