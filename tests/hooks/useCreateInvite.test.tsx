// tests/hooks/useCreateInvite.test.tsx — mutation de criação de convite
// (M1-F S4-F2). createInviteRequest mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateInvite, CREATE_INVITE_LOCAL_ERRORS, type CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ createInviteRequest: vi.fn() }));

vi.mock('@/lib/invites/createInviteRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/invites/createInviteRequest')>();
  return { ...actual, createInviteRequest: mocks.createInviteRequest };
});

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function okResult(overrides: Record<string, unknown> = {}) {
  return { outcome: 'ok', inviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-08-01T00:00:00Z', ...overrides };
}

beforeEach(() => {
  mocks.createInviteRequest.mockReset();
  mocks.createInviteRequest.mockResolvedValue(okResult());
});

describe('useCreateInvite — invariantes locais (nunca chamam a rede)', () => {
  it('authorized=false: rejeita com notAllowed, createInviteRequest não é chamado', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: false, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.notAllowed);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita com missingUser', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: null, authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.missingUser);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('actor ausente (capability desapareceu): rejeita com missingActor', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: null, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.missingActor);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('nome em branco: rejeita com blankName', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: '   ', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.blankName);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('e-mail inválido: rejeita com invalidEmail', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'nao-e-email', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.invalidEmail);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('Super Admin escolhe seller sem empresa: rejeita com missingCompany', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: null }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.missingCompany);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });

  it('sessão ausente (getAccessToken devolve null): rejeita com missingSession', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'super_admin', companyId: null }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.missingSession);
    expect(mocks.createInviteRequest).not.toHaveBeenCalled();
  });
});

describe('useCreateInvite — payload por ator', () => {
  it('Super Admin escolhe seller: payload usa role_kind/companyId do formulário', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-x');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({ name: 'Fulano', email: 'f@test.local', roleKind: 'seller', companyId: 'company-x' });
    expect(mocks.createInviteRequest).toHaveBeenCalledWith(
      { companyId: 'company-x', email: 'f@test.local', name: 'Fulano', roleKind: 'seller' },
      'token-x',
      undefined,
    );
  });

  it('Super Admin escolhe manager: payload usa role_kind manager e a empresa escolhida', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-x');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({ name: 'Gerente', email: 'g@test.local', roleKind: 'manager', companyId: 'company-y' });
    expect(mocks.createInviteRequest).toHaveBeenCalledWith(
      { companyId: 'company-y', email: 'g@test.local', name: 'Gerente', roleKind: 'manager' },
      'token-x',
      undefined,
    );
  });

  it('Super Admin escolhe super_admin: companyId sempre null, mesmo se o form mandar um companyId', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-x');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({ name: 'Admin Dois', email: 'sa2@test.local', roleKind: 'super_admin', companyId: 'company-deveria-ser-ignorado' });
    expect(mocks.createInviteRequest).toHaveBeenCalledWith(
      { companyId: null, email: 'sa2@test.local', name: 'Admin Dois', roleKind: 'super_admin' },
      'token-x',
      undefined,
    );
  });

  it('Manager: role_kind SEMPRE seller e companyId SEMPRE actor.companyId, mesmo que o form mande outra coisa (adulteração via DOM/estado)', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-m');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-2', authorized: true, actor: MANAGER, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({
      name: 'Vendedor', email: 'v@test.local',
      roleKind: 'super_admin', // tentativa de adulteração
      companyId: 'company-de-outra-empresa', // tentativa de adulteração
    });
    expect(mocks.createInviteRequest).toHaveBeenCalledWith(
      { companyId: 'company-a', email: 'v@test.local', name: 'Vendedor', roleKind: 'seller' },
      'token-m',
      undefined,
    );
  });

  it('nome/e-mail são normalizados por trim antes do envio', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-x');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({ name: '  Fulano  ', email: '  f@test.local  ', roleKind: 'seller', companyId: 'company-x' });
    const [payload] = mocks.createInviteRequest.mock.calls[0];
    expect(payload.name).toBe('Fulano');
    expect(payload.email).toBe('f@test.local');
  });
});

describe('useCreateInvite — token de acesso resolvido no momento do submit', () => {
  it('chama getAccessToken() a cada submit (nunca cacheia um token antigo)', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' });
    await result.current.createInvite({ name: 'B', email: 'b@test.local', roleKind: 'seller', companyId: 'company-a' });
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(mocks.createInviteRequest.mock.calls[0][1]).toBe('token-1');
    expect(mocks.createInviteRequest.mock.calls[1][1]).toBe('token-2');
  });
});

describe('useCreateInvite — resultado da rede é devolvido sem lançar', () => {
  it('outcome ok: resolve com o resultado completo', async () => {
    mocks.createInviteRequest.mockResolvedValue(okResult({ inviteId: 'invite-9' }));
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    const outcome = await result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' });
    expect(outcome).toEqual(okResult({ inviteId: 'invite-9' }));
  });

  it('outcome domain_error (duplicate_pending): resolve normalmente, não lança', async () => {
    mocks.createInviteRequest.mockResolvedValue({ outcome: 'domain_error', code: 'duplicate_pending' });
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    const outcome = await result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' });
    expect(outcome).toEqual({ outcome: 'domain_error', code: 'duplicate_pending' });
  });

  it('outcome rate_limited: resolve normalmente com retryAfterSeconds', async () => {
    mocks.createInviteRequest.mockResolvedValue({ outcome: 'rate_limited', retryAfterSeconds: 45 });
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    const outcome = await result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' });
    expect(outcome).toEqual({ outcome: 'rate_limited', retryAfterSeconds: 45 });
  });
});

describe('useCreateInvite — isolamento por identidade (cache generation)', () => {
  it('identidade muda enquanto o fetch está em voo: resultado tardio é descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    mocks.createInviteRequest.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient); // simula troca de identidade no meio do voo
      return okResult();
    });
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    await expect(result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' }))
      .rejects.toThrow(CREATE_INVITE_LOCAL_ERRORS.staleIdentity);
  });
});

describe('useCreateInvite — isPending', () => {
  it('true durante a chamada, false antes/depois', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    let resolveFetch: (v: unknown) => void = () => {};
    mocks.createInviteRequest.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const { result } = renderHook(
      () => useCreateInvite({ userId: 'user-1', authorized: true, actor: SUPER_ADMIN, getAccessToken }),
      { wrapper },
    );
    expect(result.current.isPending).toBe(false);
    const promise = result.current.createInvite({ name: 'A', email: 'a@test.local', roleKind: 'seller', companyId: 'company-a' });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolveFetch(okResult());
    await promise;
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
