// tests/hooks/useCompanyUsers.test.tsx — listagem paginada de usuários
// ativos (M1-F S5-D). fetchCompanyUsers mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompanyUsers } from '@/lib/hooks/useCompanyUsers';

const mocks = vi.hoisted(() => ({ fetchCompanyUsers: vi.fn() }));

vi.mock('@/lib/users/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/users/repository')>();
  return { ...actual, fetchCompanyUsers: mocks.fetchCompanyUsers };
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
    created_at: `2026-07-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`,
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
  mocks.fetchCompanyUsers.mockReset();
});

describe('useCompanyUsers — gating', () => {
  it('authorized=false: query desabilitada, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: false, scope: { kind: 'platform', companyId: null }, role: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.fetchCompanyUsers).not.toHaveBeenCalled();
  });

  it('scope=null: query desabilitada, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: null, role: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.fetchCompanyUsers).not.toHaveBeenCalled();
  });

  it('userId ausente: query desabilitada', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: null, authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
  });
});

describe('useCompanyUsers — primeira página', () => {
  it('carrega a primeira página com limit default (25)', async () => {
    mocks.fetchCompanyUsers.mockResolvedValue([row(1)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(mocks.fetchCompanyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, cursor: null }),
    );
    expect(result.current.users).toEqual([row(1)]);
  });

  it('vazio sem filtros: isEmpty true, hasData false', async () => {
    mocks.fetchCompanyUsers.mockResolvedValue([]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.hasData).toBe(false);
  });

  it('erro: isError true, users vazio', async () => {
    mocks.fetchCompanyUsers.mockRejectedValue(new Error('boom'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.users).toEqual([]);
  });
});

describe('useCompanyUsers — paginação (carregar mais)', () => {
  it('página cheia (== limit): hasMore true, permite fetchNextPage', async () => {
    const limit = 2;
    mocks.fetchCompanyUsers.mockResolvedValue([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.hasMore).toBe(true);
  });

  it('próxima página com o cursor da ÚLTIMA linha exibida (created_at + membership_id)', async () => {
    const limit = 2;
    mocks.fetchCompanyUsers.mockResolvedValueOnce([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchCompanyUsers.mockResolvedValueOnce([row(3)]);
    result.current.fetchNextPage();

    await waitFor(() => expect(result.current.users).toHaveLength(3));
    expect(mocks.fetchCompanyUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { createdAt: row(2).created_at, membershipId: row(2).membership_id } }),
    );
    // fim da lista: página mais curta que o limite
    expect(result.current.hasMore).toBe(false);
  });

  it('próxima chamada vazia: preserva os itens anteriores, marca fim da lista, nenhuma página vazia é exibida', async () => {
    const limit = 2;
    mocks.fetchCompanyUsers.mockResolvedValueOnce([row(1), row(2)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchCompanyUsers.mockResolvedValueOnce([]);
    result.current.fetchNextPage();

    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.users).toEqual([row(1), row(2)]);
  });

  it('nunca duplica linhas entre páginas', async () => {
    const limit = 1;
    mocks.fetchCompanyUsers.mockResolvedValueOnce([row(1)]);
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search: null, limit }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mocks.fetchCompanyUsers.mockResolvedValueOnce([row(2)]);
    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.users).toHaveLength(2));

    const ids = result.current.users.map((u) => u.membership_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('useCompanyUsers — troca de filtro reinicia cursor', () => {
  it('mudar search gera uma key diferente (nova paginação do zero)', async () => {
    mocks.fetchCompanyUsers.mockResolvedValue([row(1)]);
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      (search: string | null) =>
        useCompanyUsers({ userId: 'user-1', authorized: true, scope: { kind: 'platform', companyId: null }, role: null, search }),
      { wrapper, initialProps: null as string | null },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    const firstKey = result.current.queryKey;

    rerender('ana');
    await waitFor(() => expect(result.current.queryKey).not.toEqual(firstKey));
  });
});
