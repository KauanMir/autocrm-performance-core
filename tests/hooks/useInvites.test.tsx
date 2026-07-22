// Testes de useInvites (M1-F S4-F1).
// Mock isolado de lib/supabase/client (cadeia from→select→order→order[→eq]).
// Nenhuma rede real, nenhum Supabase remoto. Exercita lib/invites/repository.ts
// indiretamente, mesmo padrão de tests/hooks/useCompanies.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInvites } from '@/lib/hooks/useInvites';
import { adminInviteQueryKeys } from '@/lib/invites/queryKeys';
import type { AdminInviteListItem } from '@/lib/invites/repository';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from },
  isSupabaseConfigured: true,
}));

function inviteRow(overrides: Partial<AdminInviteListItem> = {}): AdminInviteListItem {
  return {
    id: 'invite-1',
    company_id: 'company-a',
    invited_by_profile_id: 'manager-1',
    name: 'Convidado',
    email: 'convidado@exemplo.test',
    role_kind: 'seller',
    status: 'pending',
    expires_at: '2026-07-28T12:00:00+00:00',
    accepted_at: null,
    created_at: '2026-07-21T12:00:00+00:00',
    ...overrides,
  };
}

// order2() devolve um objeto que É a própria Promise (via Object.assign) E
// tem um método .eq — assim `await query` funciona tanto quando o
// repository não chama .eq (escopo platform) quanto quando chama (escopo
// company, que reatribui `query` ao retorno de .eq).
function mockInvitesResponse(response: { data: unknown; error: unknown }) {
  const finalResult = Promise.resolve(response);
  const eq = vi.fn().mockReturnValue(finalResult);
  const order2 = vi.fn(() => Object.assign(Promise.resolve(response), { eq }));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select });
  return { select, order1, order2, eq };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useInvites — não autorizado / sem usuário / sem escopo', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('authorized=false: nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: false, scope: { kind: 'platform' } }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result.current.invites).toEqual([]);
  });

  it('userId ausente: nenhuma query é executada mesmo com authorized=true', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: null, authorized: true, scope: { kind: 'platform' } }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('scope null (ex.: Manager sem membership ativa resolvida): nenhuma query é executada', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: null }),
      { wrapper },
    );
    expect(result.current.queryEnabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('key sentinela quando desabilitado, distinta de qualquer identidade/escopo real', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: null, authorized: true, scope: null }),
      { wrapper },
    );
    expect(result.current.queryKey).toEqual(['admin-invites', null, 'disabled']);
  });
});

describe('useInvites — escopo company', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('aplica .eq("company_id", companyId) — nunca infere no servidor', async () => {
    const { eq } = mockInvitesResponse({ data: [inviteRow()], error: null });
    const { wrapper } = createWrapper();
    renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(eq).toHaveBeenCalledWith('company_id', 'company-a'));
  });

  it('SELECT exato: só as 10 colunas da whitelist, nunca token_hash/email_normalized/accepted_profile_id/updated_at/delivery_*', async () => {
    const { select } = mockInvitesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(mocks.from).toHaveBeenCalledWith('invites');
    const selectedColumns = (select as any).mock.calls[0][0] as string;
    expect(selectedColumns).toBe(
      'id, company_id, invited_by_profile_id, name, email, role_kind, status, expires_at, accepted_at, created_at',
    );
    expect(selectedColumns).not.toMatch(/token_hash/);
    expect(selectedColumns).not.toMatch(/email_normalized/);
    expect(selectedColumns).not.toMatch(/accepted_profile_id/);
    expect(selectedColumns).not.toMatch(/updated_at/);
    expect(selectedColumns).not.toMatch(/delivery/);
  });

  it('lista com múltiplos convites da empresa', async () => {
    mockInvitesResponse({ data: [inviteRow({ id: 'i1' }), inviteRow({ id: 'i2', status: 'accepted' })], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.invites).toHaveLength(2);
    expect(result.current.queryKey).toEqual(adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }));
  });

  it('empty state: lista vazia', async () => {
    mockInvitesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
  });
});

describe('useInvites — escopo platform (Super Admin)', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('NÃO aplica nenhum filtro de empresa (.eq nunca é chamado)', async () => {
    const { eq } = mockInvitesResponse({ data: [inviteRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'platform' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(eq).not.toHaveBeenCalled();
  });

  it('query key usa o segmento "platform", nunca companyId', () => {
    mockInvitesResponse({ data: [], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'platform' } }),
      { wrapper },
    );
    expect(result.current.queryKey).toEqual(['admin-invites', 'user-1', 'platform']);
  });
});

describe('useInvites — erro e retry', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('erro do Supabase é exposto, nunca vira lista vazia silenciosa', async () => {
    mockInvitesResponse({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.invites).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });

  it('refetch dispara nova chamada', async () => {
    mockInvitesResponse({ data: [inviteRow()], error: null });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInvites({ userId: 'user-1', authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    const callsBefore = mocks.from.mock.calls.length;
    result.current.refetch();
    await waitFor(() => expect(mocks.from.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe('useInvites — isolamento por identidade e por escopo (cache partition)', () => {
  beforeEach(() => {
    mocks.from.mockReset();
  });

  it('troca de usuário não reaproveita cache', async () => {
    mockInvitesResponse({ data: [inviteRow()], error: null });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useInvites({ userId, authorized: true, scope: { kind: 'company', companyId: 'company-a' } }),
      { wrapper, initialProps: { userId: 'user-a' } },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.queryKey).toEqual(adminInviteQueryKeys.list('user-a', { kind: 'company', companyId: 'company-a' }));

    rerender({ userId: 'user-b' });
    expect(result.current.queryKey).toEqual(adminInviteQueryKeys.list('user-b', { kind: 'company', companyId: 'company-a' }));
  });

  it('troca de empresa (mesmo usuário) não reaproveita cache incorreto', async () => {
    mockInvitesResponse({ data: [inviteRow()], error: null });
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string }) =>
        useInvites({ userId: 'user-a', authorized: true, scope: { kind: 'company', companyId } }),
      { wrapper, initialProps: { companyId: 'company-a' } },
    );
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.queryKey).toEqual(adminInviteQueryKeys.list('user-a', { kind: 'company', companyId: 'company-a' }));

    rerender({ companyId: 'company-b' });
    expect(result.current.queryKey).toEqual(adminInviteQueryKeys.list('user-a', { kind: 'company', companyId: 'company-b' }));
  });
});
