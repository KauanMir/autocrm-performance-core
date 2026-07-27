// tests/hooks/useUpdateUserEmail.test.tsx — mutation de alteração
// administrativa de e-mail (M1-F S5-E1-B). updateUserEmailRequest mockado —
// nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateUserEmail,
  UPDATE_USER_EMAIL_LOCAL_ERRORS,
  getUpdateUserEmailErrorMessage,
} from '@/lib/hooks/useUpdateUserEmail';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';

const mocks = vi.hoisted(() => ({ updateUserEmailRequest: vi.fn() }));

vi.mock('@/lib/users/emailRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/users/emailRequest')>();
  return { ...actual, updateUserEmailRequest: mocks.updateUserEmailRequest };
});

const PROFILE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const USER_ID = 'user-1';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function getAccessTokenOk() {
  return Promise.resolve('access-token-x');
}

beforeEach(() => {
  mocks.updateUserEmailRequest.mockReset();
  mocks.updateUserEmailRequest.mockResolvedValue({ outcome: 'ok', profileId: PROFILE_ID, email: 'novo@test.local' });
});

describe('useUpdateUserEmail — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a requisição', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: false, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.notAllowed);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: null, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.missingUser);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });

  it('profileId inválido (não-UUID): rejeita, nunca chama a requisição', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: 'nao-e-uuid', email: 'novo@test.local' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidTarget);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });

  it('e-mail vazio: rejeita, nunca chama a requisição', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: '   ' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });

  it('e-mail com formato inválido: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'nao-e-email' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.invalidEmail);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });

  it('sessão ausente (getAccessToken retorna null): rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: () => Promise.resolve(null) }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.missingSession);
    expect(mocks.updateUserEmailRequest).not.toHaveBeenCalled();
  });
});

describe('useUpdateUserEmail — resultado da requisição', () => {
  it('sucesso: normaliza (trim+lowercase) antes de enviar, resolve outcome ok', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    const outcome = await result.current.updateUserEmail({ profileId: PROFILE_ID, email: '  Novo@Test.Local  ' });
    expect(outcome).toEqual({ outcome: 'ok', profileId: PROFILE_ID, email: 'novo@test.local' });
    expect(mocks.updateUserEmailRequest).toHaveBeenCalledWith(PROFILE_ID, 'novo@test.local', 'access-token-x', undefined);
  });

  it('erro de domínio (ex.: email_already_in_use): resolve normalmente, nunca lança', async () => {
    mocks.updateUserEmailRequest.mockResolvedValue({ outcome: 'domain_error', code: 'email_already_in_use' });
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    const outcome = await result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' });
    expect(outcome).toEqual({ outcome: 'domain_error', code: 'email_already_in_use' });
  });
});

describe('useUpdateUserEmail — invalidação de cache', () => {
  it('sucesso (outcome ok): invalida companyUserQueryKeys.root(userId)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyUserQueryKeys.root(USER_ID) });
  });

  it('domain_error: NÃO invalida (nada mudou de fato no servidor)', async () => {
    mocks.updateUserEmailRequest.mockResolvedValue({ outcome: 'domain_error', code: 'user_email_state_conflict' });
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useUpdateUserEmail — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante a chamada: resultado descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.updateUserEmailRequest.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return { outcome: 'ok', profileId: PROFILE_ID, email: 'novo@test.local' };
    });
    const { result } = renderHook(
      () => useUpdateUserEmail({ userId: USER_ID, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.updateUserEmail({ profileId: PROFILE_ID, email: 'novo@test.local' }))
      .rejects.toThrow(UPDATE_USER_EMAIL_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getUpdateUserEmailErrorMessage', () => {
  it('mapeia erros locais e de domínio para as mensagens estáveis exigidas, nunca texto bruto', () => {
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'unauthenticated' })).toBe('Sua sessão expirou. Entre novamente.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'forbidden' })).toBe('Você não tem permissão para alterar este e-mail.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'invalid_email' })).toBe('Informe um endereço de e-mail válido.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'user_not_found' })).toBe('Usuário não encontrado ou indisponível.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'user_inactive' })).toBe('Este usuário está inativo.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'email_already_in_use' })).toBe('Este e-mail não está disponível.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'user_email_state_conflict' })).toBe('Os dados de e-mail deste usuário precisam de revisão antes da alteração.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'email_update_failed' })).toBe('Não foi possível concluir a alteração. Nenhuma mudança foi mantida.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'email_compensation_failed' })).toBe('A alteração não pôde ser concluída e precisa de revisão administrativa.');
    expect(getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: '42501' })).not.toMatch(/42501/);
  });

  it('nunca revela quem já usa o e-mail (mensagem genérica de disponibilidade)', () => {
    const message = getUpdateUserEmailErrorMessage({ outcome: 'domain_error', code: 'email_already_in_use' });
    expect(message).not.toMatch(/@/);
  });
});
