// tests/hooks/useCancelInvite.test.tsx — mutation de cancelamento de
// convite (M1-F S4-F3). cancelInviteRpc mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCancelInvite, CANCEL_INVITE_LOCAL_ERRORS, getCancelInviteErrorMessage } from '@/lib/hooks/useCancelInvite';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ cancelInviteRpc: vi.fn() }));

vi.mock('@/lib/invites/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/invites/repository')>();
  return { ...actual, cancelInviteRpc: mocks.cancelInviteRpc };
});

const INVITE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.cancelInviteRpc.mockReset();
  mocks.cancelInviteRpc.mockResolvedValue({ outcome: 'ok', inviteId: INVITE_ID, status: 'canceled' });
});

describe('useCancelInvite — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelInvite({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.cancelInvite(INVITE_ID)).rejects.toThrow(CANCEL_INVITE_LOCAL_ERRORS.notAllowed);
    expect(mocks.cancelInviteRpc).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelInvite({ userId: null, authorized: true }), { wrapper });
    await expect(result.current.cancelInvite(INVITE_ID)).rejects.toThrow(CANCEL_INVITE_LOCAL_ERRORS.missingUser);
    expect(mocks.cancelInviteRpc).not.toHaveBeenCalled();
  });

  it('id inválido (não-UUID): rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelInvite({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.cancelInvite('nao-e-uuid')).rejects.toThrow(CANCEL_INVITE_LOCAL_ERRORS.invalidId);
    expect(mocks.cancelInviteRpc).not.toHaveBeenCalled();
  });
});

describe('useCancelInvite — resultado da RPC', () => {
  it('outcome ok: resolve sem lançar, chama cancelInviteRpc com o id exato', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelInvite({ userId: 'user-1', authorized: true }), { wrapper });
    const outcome = await result.current.cancelInvite(INVITE_ID);
    expect(outcome).toEqual({ outcome: 'ok', inviteId: INVITE_ID, status: 'canceled' });
    expect(mocks.cancelInviteRpc).toHaveBeenCalledWith(INVITE_ID);
  });

  it('outcome domain_error (invite_not_found, ex.: cross-tenant): resolve normalmente, nunca lança', async () => {
    mocks.cancelInviteRpc.mockResolvedValue({ outcome: 'domain_error', code: 'invite_not_found' });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelInvite({ userId: 'user-1', authorized: true }), { wrapper });
    const outcome = await result.current.cancelInvite(INVITE_ID);
    expect(outcome).toEqual({ outcome: 'domain_error', code: 'invite_not_found' });
  });
});

describe('useCancelInvite — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante a chamada: resultado descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.cancelInviteRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return { outcome: 'ok', inviteId: INVITE_ID, status: 'canceled' };
    });
    const { result } = renderHook(() => useCancelInvite({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.cancelInvite(INVITE_ID)).rejects.toThrow(CANCEL_INVITE_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getCancelInviteErrorMessage', () => {
  it('mapeia erros locais e de domínio para mensagens estáveis, nunca texto bruto', () => {
    expect(getCancelInviteErrorMessage(new Error(CANCEL_INVITE_LOCAL_ERRORS.notAllowed))).toMatch(/permissão/);
    expect(getCancelInviteErrorMessage({ outcome: 'domain_error', code: 'invite_not_found' })).toMatch(/não está mais disponível/);
    expect(getCancelInviteErrorMessage({ outcome: 'domain_error', code: 'invite_not_actionable' })).toMatch(/não pode mais ser cancelado/);
    expect(getCancelInviteErrorMessage({ outcome: 'domain_error', code: '42501' })).not.toMatch(/42501/);
  });
});
