// tests/hooks/useInactiveCompanyUsers.test.tsx — listagem paginada de
// memberships inativas (M1-F S6-E). fetchInactiveCompanyUsers mockado —
// nenhuma rede real. Mesmo padrão de tests/hooks/useCompanyUsers.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInactiveCompanyUsers } from '@/lib/hooks/useInactiveCompanyUsers';

const mocks = vi.hoisted(() => ({ fetchInactiveCompanyUsers: vi.fn() }));

vi.mock('@/lib/inactiveUsers/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inactiveUsers/repository')>();
  return { ...actual, fetchInactiveCompanyUsers: mocks.fetchInactiveCompanyUsers };
});

function row(i: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    profile_id: `profile-${i}`,
    membership_id: `membership-${i}`,
    name: `Usuário ${i}`,
    email: `user${i}@empresa.com`,
    company_id: 'company-1',
    company_name: 'Empresa A',
    company_role: 'seller' as const,
    lifecycle_status: 'suspended' as const,
    is_active: false,
    created_at: `2026-07-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`,
    updated_at: `2026-07-${String(27 - i).padStart(2, '0')}T10:00:00.000Z`,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.fetchInactiveCompanyUsers.mockReset();
});

describe('useInactiveCompanyUsers — gating', () => {
  it('authorized=false: query desabilitada, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: false, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.fetchInactiveCompanyUsers).not.toHaveBeenCalled();
  });

  it('scope=null: query desabilitada, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: null, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.fetchInactiveCompanyUsers).not.toHaveBeenCalled();
  });

  it('userId ausente: query desabilitada', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: null, authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
  });
});

describe('useInactiveCompanyUsers — primeira página', () => {
  it('carrega a primeira página com limit default (25)', async () => {
    mocks.fetchInactiveCompanyUsers.mockResolvedValue([row(1)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchInactiveCompanyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, cursor: null }),
    );
    expect(result.current.users).toEqual([row(1)]);
  });

  it('vazio sem filtros: isEmpty true, hasData false', async () => {
    mocks.fetchInactiveCompanyUsers.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
  });

  it('erro: isError true, users vazio', async () => {
    mocks.fetchInactiveCompanyUsers.mockRejectedValue(new Error('boom'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.users).toEqual([]);
  });
});

describe('useInactiveCompanyUsers — paginação (carregar mais)', () => {
  it('página cheia (== limit): hasMore true, permite fetchNextPage', async () => {
    const limit = 2;
    mocks.fetchInactiveCompanyUsers.mockResolvedValue([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.hasMore).toBe(true);
  });

  it('próxima página com o cursor da ÚLTIMA linha exibida (updated_at + membership_id, nunca created_at)', async () => {
    const limit = 2;
    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([row(3)]);
    result.current.fetchNextPage();

    await waitFor(() => expect(result.current.users).toHaveLength(3));
    expect(mocks.fetchInactiveCompanyUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { updatedAt: row(2).updated_at, membershipId: row(2).membership_id } }),
    );
    // fim da lista: página mais curta que o limite
    expect(result.current.hasMore).toBe(false);
  });

  it('próxima chamada vazia: preserva os itens anteriores, marca fim da lista, nenhuma página vazia é exibida', async () => {
    const limit = 2;
    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([]);
    result.current.fetchNextPage();

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.users).toEqual([row(1), row(2)]);
  });

  it('nunca duplica linhas entre páginas', async () => {
    const limit = 1;
    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([row(1)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchInactiveCompanyUsers.mockResolvedValueOnce([row(2)]);
    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.users).toHaveLength(2));

    const ids = result.current.users.map((u) => u.membership_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('useInactiveCompanyUsers — troca de filtro reinicia cursor', () => {
  it('mudar search gera uma key diferente (nova paginação do zero)', async () => {
    mocks.fetchInactiveCompanyUsers.mockResolvedValue([row(1)]);
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      (search: string | null) =>
        useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle: null, search }),
      { wrapper, initialProps: null as string | null },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    const firstKey = result.current.queryKey;

    rerender('ana');
    await waitFor(() => expect(result.current.queryKey).not.toEqual(firstKey));
  });

  it('mudar lifecycle gera uma key diferente (nova paginação do zero)', async () => {
    mocks.fetchInactiveCompanyUsers.mockResolvedValue([row(1)]);
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      (lifecycle: 'suspended' | 'offboarded' | null) =>
        useInactiveCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, lifecycle, search: null }),
      { wrapper, initialProps: null as 'suspended' | 'offboarded' | null },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    const firstKey = result.current.queryKey;

    rerender('offboarded');
    await waitFor(() => expect(result.current.queryKey).not.toEqual(firstKey));
  });
});
