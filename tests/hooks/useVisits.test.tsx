// Testes de useVisits (COMMERCIAL-REMOTE-VISITS-B2-A). Mock isolado de
// lib/supabase/client (cadeia from→select→order→order) e mock controlável
// de resolveVisitRemoteMode. Nenhuma rede real, nenhum store, nenhuma
// dependência de Lead/Seller catalog. Mesmo padrão de
// tests/hooks/useTasks.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVisits, type UseVisitsOptions } from '@/lib/hooks/useVisits';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import type { RemoteVisitRow } from '@/lib/visits/adapter';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  resolveVisitRemoteMode: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/visits/remoteVisitsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/visits/remoteVisitsMode')>();
  return { ...actual, resolveVisitRemoteMode: mocks.resolveVisitRemoteMode };
});

function visitRow(overrides: Partial<RemoteVisitRow> = {}): RemoteVisitRow {
  return {
    id: 'visit-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name: null,
    assigned_seller_id: 's1',
    vehicles: ['Golf GTI 2022'],
    scheduled_at: '2026-08-21T17:00:00+00:00',
    status: 'scheduled',
    outcome: null,
    note: '',
    result_note: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    closed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    closed_at: null,
    version: 1,
    ...overrides,
  };
}

const MANAGER_OPTIONS: UseVisitsOptions = {
  userId: 'user-1',
  companyId: 'company-a',
  membershipRole: 'manager',
  userIsActive: true,
};

const SELLER_OPTIONS: UseVisitsOptions = {
  ...MANAGER_OPTIONS,
  membershipRole: 'seller',
};

function mockVisitsResponse(response: { data: unknown; error: unknown }) {
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select });
  return { select, order1, order2 };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.resolveVisitRemoteMode.mockReturnValue('visit_local');
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe('useVisits — modos desabilitados (zero request)', () => {
  it.each([
    ['visit_local', 'visit_local'],
    ['visit_blocked', 'visit_blocked'],
    ['visit_remote_misconfigured', 'visit_remote_misconfigured'],
  ] as const)('mode=%s ⇒ queryEnabled=false, nenhuma chamada', (_label, mode) => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    mockVisitsResponse({ data: [visitRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useVisits — remote_ready com identidade incompleta (zero request)', () => {
  beforeEach(() => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    mockVisitsResponse({ data: [visitRow()], error: null });
  });

  it('sem userId ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits({ ...MANAGER_OPTIONS, userId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sem companyId ⇒ nenhuma chamada, key sentinela sem colisão', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits({ ...MANAGER_OPTIONS, companyId: null }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(result.current.queryKey).toEqual(['company', null, 'visits', 'disabled']);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('usuário inativo ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits({ ...MANAGER_OPTIONS, userIsActive: false }), { wrapper });
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('role inválido (nem manager nem seller) ⇒ nenhuma chamada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useVisits({ ...MANAGER_OPTIONS, membershipRole: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('useVisits — remote_ready com identidade completa', () => {
  beforeEach(() => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
  });

  it('Manager: executa UMA leitura com a key da empresa', async () => {
    mockVisitsResponse({ data: [visitRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    expect(result.current.queryKey).toEqual(visitQueryKeys.active('company-a'));
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('Seller: também habilita a query', async () => {
    mockVisitsResponse({ data: [visitRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(SELLER_OPTIONS), { wrapper });
    expect(result.current.queryEnabled).toBe(true);
    await waitFor(() => expect(result.current.hasData).toBe(true));
  });

  it('sucesso: rows CRUAS na ordem recebida, nenhuma adaptação', async () => {
    mockVisitsResponse({
      data: [visitRow({ id: 'visit-a' }), visitRow({ id: 'visit-b', lead_id: null, client_name: 'Avulso' })],
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(['visit-a', 'visit-b']);
    expect(result.current.rows[0].scheduled_at).toBe('2026-08-21T17:00:00+00:00');
    expect(result.current.rows[0]).not.toHaveProperty('clientName');
    expect(result.current.rows[0]).not.toHaveProperty('assignedSellerId');
  });

  it('lista vazia permanece vazia (isEmpty true, hasData false)', async () => {
    mockVisitsResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    expect(result.current.rows).toEqual([]);
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('erro remoto é exposto sem fallback local', async () => {
    mockVisitsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect((result.current.error as { message?: string })?.message).toBe('remote_visits_fetch_failed');
  });

  it('não escreve em localStorage durante a leitura remota', async () => {
    mockVisitsResponse({ data: [visitRow()], error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('companies diferentes não compartilham cache', async () => {
    mockVisitsResponse({ data: [visitRow()], error: null });
    const { queryClient, wrapper } = createWrapper();

    const a = renderHook(() => useVisits(MANAGER_OPTIONS), { wrapper });
    await waitFor(() => expect(a.result.current.hasData).toBe(true));

    mockVisitsResponse({ data: [], error: null });
    const b = renderHook(() => useVisits({ ...MANAGER_OPTIONS, companyId: 'company-b' }), { wrapper });
    expect(b.result.current.queryKey).toEqual(visitQueryKeys.active('company-b'));
    await waitFor(() => expect(b.result.current.isEmpty).toBe(true));

    expect(a.result.current.rows).toHaveLength(1);
    expect(b.result.current.rows).toHaveLength(0);
    expect(queryClient.getQueryData(visitQueryKeys.active('company-a'))).not.toEqual(
      queryClient.getQueryData(visitQueryKeys.active('company-b')),
    );
  });
});
