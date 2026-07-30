// Testes de useRemoteLeadsScreenState (M1-E, E3-B1). Os três hooks internos
// (usePipelineStages/useCurrentCompanySellerLabels/useLeads) são mockados —
// cada um já tem cobertura própria; aqui o alvo é a COMPOSIÇÃO: modo
// resultante, prontidão repassada a useLeads, e a garantia de que os três
// são sempre chamados (Rules of Hooks) independente do modo.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRemoteLeadsScreenState } from '@/lib/hooks/useRemoteLeadsScreenState';
import type { User } from '@/lib/data';

const mocks = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useCurrentCompanySellerLabels: vi.fn(),
  useLeads: vi.fn(),
  resolveRemoteLeadsFlagMode: vi.fn(),
  getStages: vi.fn(),
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({ usePipelineStages: mocks.usePipelineStages }));
vi.mock('@/lib/hooks/useCurrentCompanySellerLabels', () => ({
  useCurrentCompanySellerLabels: mocks.useCurrentCompanySellerLabels,
}));
vi.mock('@/lib/hooks/useLeads', () => ({ useLeads: mocks.useLeads }));
vi.mock('@/lib/leads/remoteLeadsMode', () => ({
  resolveRemoteLeadsFlagMode: mocks.resolveRemoteLeadsFlagMode,
}));
vi.mock('@/lib/services', () => ({
  PipelineService: { getStages: mocks.getStages },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return wrapper;
}

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Gerente',
    email: 'g@a.com',
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}

function pipelineResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true,
    queryKey: [], stages: [], byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: true, refetch: vi.fn(),
    ...overrides,
  };
}

function sellerLabelsResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    sellerLabels: [], sellersById: {}, isLoading: false, isFetching: false,
    isError: false, error: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...overrides,
  };
}

function leadsResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    remoteLeadsEnabled: true, queryEnabled: true, queryKey: [],
    leads: [], isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: true, hasData: false, refetch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.usePipelineStages.mockReset().mockReturnValue(pipelineResult());
  mocks.useCurrentCompanySellerLabels.mockReset().mockReturnValue(sellerLabelsResult());
  mocks.useLeads.mockReset().mockReturnValue(leadsResult());
  mocks.resolveRemoteLeadsFlagMode.mockReset().mockReturnValue('remote_ready');
  mocks.getStages.mockReset().mockReturnValue(['Novo', 'Qualificado']);
});

describe('useRemoteLeadsScreenState — modo', () => {
  it('flag local → mode local, mesmo com identidade válida', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    const { result } = renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(result.current.mode).toBe('local');
  });

  it('flag remote_misconfigured → mode remote_misconfigured', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    const { result } = renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(result.current.mode).toBe('remote_misconfigured');
  });

  it('remote_ready mas sem membership ativa → remote_unavailable_identity', () => {
    const { result } = renderHook(
      () => useRemoteLeadsScreenState(manager({ activeMembership: null })),
      { wrapper: createWrapper() },
    );
    expect(result.current.mode).toBe('remote_unavailable_identity');
  });

  it('remote_ready mas currentUser null → remote_unavailable_identity', () => {
    const { result } = renderHook(() => useRemoteLeadsScreenState(null), { wrapper: createWrapper() });
    expect(result.current.mode).toBe('remote_unavailable_identity');
  });

  it('Manager com membership ativa e remote_ready → remote_active', () => {
    const { result } = renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(result.current.mode).toBe('remote_active');
  });

  it('Seller com membership ativa e remote_ready → remote_active', () => {
    const seller = manager({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } });
    const { result } = renderHook(() => useRemoteLeadsScreenState(seller), { wrapper: createWrapper() });
    expect(result.current.mode).toBe('remote_active');
  });
});

describe('useRemoteLeadsScreenState — Rules of Hooks (sempre chamados)', () => {
  it('os três hooks são chamados mesmo em modo local', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.usePipelineStages).toHaveBeenCalledTimes(1);
    expect(mocks.useCurrentCompanySellerLabels).toHaveBeenCalledTimes(1);
    expect(mocks.useLeads).toHaveBeenCalledTimes(1);
  });

  it('os três hooks são chamados mesmo sem identidade', () => {
    renderHook(() => useRemoteLeadsScreenState(null), { wrapper: createWrapper() });
    expect(mocks.usePipelineStages).toHaveBeenCalledTimes(1);
    expect(mocks.useCurrentCompanySellerLabels).toHaveBeenCalledTimes(1);
    expect(mocks.useLeads).toHaveBeenCalledTimes(1);
  });
});

describe('useRemoteLeadsScreenState — prontidão repassada a useLeads', () => {
  it('stagesReady=true somente quando pipeline.hasData; sellersReady=true quando sellerLabels resolveu (mesmo vazio)', () => {
    mocks.usePipelineStages.mockReturnValue(pipelineResult({ hasData: true, byId: { s1: {} } }));
    mocks.useCurrentCompanySellerLabels.mockReturnValue(sellerLabelsResult({ isLoading: false, isError: false }));
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.useLeads).toHaveBeenCalledWith(
      expect.objectContaining({ stagesReady: true, sellersReady: true, stagesById: { s1: {} } }),
    );
  });

  it('stagesReady=false quando pipeline ainda não tem dados (mesmo sem erro)', () => {
    mocks.usePipelineStages.mockReturnValue(pipelineResult({ hasData: false, isLoading: true }));
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.useLeads).toHaveBeenCalledWith(expect.objectContaining({ stagesReady: false }));
  });

  it('sellersReady=false enquanto sellerLabels está carregando', () => {
    mocks.useCurrentCompanySellerLabels.mockReturnValue(sellerLabelsResult({ isLoading: true }));
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.useLeads).toHaveBeenCalledWith(expect.objectContaining({ sellersReady: false }));
  });

  it('sellersReady=false quando sellerLabels está em erro', () => {
    mocks.useCurrentCompanySellerLabels.mockReturnValue(sellerLabelsResult({ isError: true, isLoading: false }));
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.useLeads).toHaveBeenCalledWith(expect.objectContaining({ sellersReady: false }));
  });

  it('useLeads recebe a identidade exata (userId/companyId/userIsActive)', () => {
    renderHook(() => useRemoteLeadsScreenState(manager()), { wrapper: createWrapper() });
    expect(mocks.useLeads).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', companyId: 'company-a', userIsActive: true }),
    );
  });
});
