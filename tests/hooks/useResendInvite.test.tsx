// tests/hooks/useResendInvite.test.tsx — mutation de reenvio de convite
// (M1-F S4-F3). resendInviteRequest mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useResendInvite, RESEND_INVITE_LOCAL_ERRORS, getResendInviteErrorMessage } from '@/lib/hooks/useResendInvite';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ resendInviteRequest: vi.fn() }));

vi.mock('@/lib/invites/resendInviteRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/invites/resendInviteRequest')>();
  return { ...actual, resendInviteRequest: mocks.resendInviteRequest };
});

const INVITE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

function okResult(overrides: Record<string, unknown> = {}) {
  return { outcome: 'ok', inviteId: 'invite-new', previousInviteId: INVITE_ID, status: 'pending', deliveryStatus: 'sent', expiresAt: '2026-08-01T00:00:00Z', ...overrides };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.resendInviteRequest.mockReset();
  mocks.resendInviteRequest.mockResolvedValue(okResult());
});

describe('useResendInvite — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a rede', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: false, getAccessToken }), { wrapper });
    await expect(result.current.resendInvite(INVITE_ID)).rejects.toThrow(RESEND_INVITE_LOCAL_ERRORS.notAllowed);
    expect(mocks.resendInviteRequest).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => useResendInvite({ userId: null, authorized: true, getAccessToken }), { wrapper });
    await expect(result.current.resendInvite(INVITE_ID)).rejects.toThrow(RESEND_INVITE_LOCAL_ERRORS.missingUser);
    expect(mocks.resendInviteRequest).not.toHaveBeenCalled();
  });

  it('id inválido (não-UUID): rejeita, nunca chama a rede', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    await expect(result.current.resendInvite('nao-e-uuid')).rejects.toThrow(RESEND_INVITE_LOCAL_ERRORS.invalidId);
    expect(mocks.resendInviteRequest).not.toHaveBeenCalled();
  });

  it('sessão ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    await expect(result.current.resendInvite(INVITE_ID)).rejects.toThrow(RESEND_INVITE_LOCAL_ERRORS.missingSession);
    expect(mocks.resendInviteRequest).not.toHaveBeenCalled();
  });
});

describe('useResendInvite — resultado da rede', () => {
  it('outcome ok: resolve sem lançar', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token-x');
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    const outcome = await result.current.resendInvite(INVITE_ID);
    expect(outcome).toEqual(okResult());
    expect(mocks.resendInviteRequest).toHaveBeenCalledWith(INVITE_ID, 'token-x', undefined);
  });

  it('outcome domain_error (invite_not_actionable): resolve normalmente', async () => {
    mocks.resendInviteRequest.mockResolvedValue({ outcome: 'domain_error', code: 'invite_not_actionable' });
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    const outcome = await result.current.resendInvite(INVITE_ID);
    expect(outcome).toEqual({ outcome: 'domain_error', code: 'invite_not_actionable' });
  });

  it('AbortSignal é repassado ao request', async () => {
    const { wrapper } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    const controller = new AbortController();
    await result.current.resendInvite(INVITE_ID, controller.signal);
    expect(mocks.resendInviteRequest).toHaveBeenCalledWith(INVITE_ID, 'token', controller.signal);
  });
});

describe('useResendInvite — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante o fetch: resultado descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const getAccessToken = vi.fn().mockResolvedValue('token');
    mocks.resendInviteRequest.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return okResult();
    });
    const { result } = renderHook(() => useResendInvite({ userId: 'user-1', authorized: true, getAccessToken }), { wrapper });
    await expect(result.current.resendInvite(INVITE_ID)).rejects.toThrow(RESEND_INVITE_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getResendInviteErrorMessage', () => {
  it('mapeia erros locais e de domínio para mensagens estáveis, nunca texto bruto', () => {
    expect(getResendInviteErrorMessage(new Error(RESEND_INVITE_LOCAL_ERRORS.notAllowed))).toMatch(/permissão/);
    expect(getResendInviteErrorMessage({ outcome: 'domain_error', code: 'invite_not_actionable' })).toMatch(/não pode mais ser reenviado/);
    expect(getResendInviteErrorMessage({ outcome: 'rate_limited', retryAfterSeconds: 30 })).toMatch(/Aguarde/);
    expect(getResendInviteErrorMessage({ outcome: 'domain_error', code: '42501' })).not.toMatch(/42501/);
  });
});
