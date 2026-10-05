// tests/hooks/useStartMetaOAuth.test.ts — mutation do início do fluxo OAuth
// Meta (META-OAUTH-REVIEW-UI). startMetaOAuthRequest mockado — nenhuma rede
// real, nenhuma navegação de browser real (navigate injetado).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useStartMetaOAuth,
  START_META_OAUTH_LOCAL_ERRORS,
  getStartMetaOAuthErrorMessage,
} from '@/lib/hooks/useStartMetaOAuth';

const mocks = vi.hoisted(() => ({ startMetaOAuthRequest: vi.fn() }));

vi.mock('@/lib/integrations/metaOAuthStartRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/metaOAuthStartRequest')>();
  return { ...actual, startMetaOAuthRequest: mocks.startMetaOAuthRequest };
});

const COMPANY_ID = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const AUTH_URL = 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1&state=abc';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return wrapper;
}

function getAccessTokenOk() {
  return Promise.resolve('access-token-x');
}

beforeEach(() => {
  mocks.startMetaOAuthRequest.mockReset();
  mocks.startMetaOAuthRequest.mockResolvedValue({ outcome: 'ok', authorizationUrl: AUTH_URL });
});

describe('useStartMetaOAuth — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a requisição', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: false, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.startMetaOAuth()).rejects.toThrow(START_META_OAUTH_LOCAL_ERRORS.notAllowed);
    expect(mocks.startMetaOAuthRequest).not.toHaveBeenCalled();
  });

  it('companyId ausente: rejeita, nunca chama a requisição', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: null, authorized: true, getAccessToken: getAccessTokenOk }),
      { wrapper },
    );
    await expect(result.current.startMetaOAuth()).rejects.toThrow(START_META_OAUTH_LOCAL_ERRORS.missingCompany);
    expect(mocks.startMetaOAuthRequest).not.toHaveBeenCalled();
  });

  it('sessão ausente (getAccessToken retorna null): rejeita, nunca chama a requisição', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: true, getAccessToken: () => Promise.resolve(null) }),
      { wrapper },
    );
    await expect(result.current.startMetaOAuth()).rejects.toThrow(START_META_OAUTH_LOCAL_ERRORS.missingSession);
    expect(mocks.startMetaOAuthRequest).not.toHaveBeenCalled();
  });
});

describe('useStartMetaOAuth — resultado da requisição e navegação', () => {
  it('sucesso: chama startMetaOAuthRequest com companyId/token/flow e navega para a authorizationUrl', async () => {
    const navigate = vi.fn();
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: true, flow: 'review_ui', getAccessToken: getAccessTokenOk, navigate }),
      { wrapper },
    );
    const outcome = await result.current.startMetaOAuth();
    expect(outcome).toEqual({ outcome: 'ok', authorizationUrl: AUTH_URL });
    expect(mocks.startMetaOAuthRequest).toHaveBeenCalledWith(COMPANY_ID, 'access-token-x', 'review_ui');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(AUTH_URL);
  });

  it('sem `flow`: chama startMetaOAuthRequest com flow undefined (fluxo normal continua funcionando)', async () => {
    const navigate = vi.fn();
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: true, getAccessToken: getAccessTokenOk, navigate }),
      { wrapper },
    );
    await result.current.startMetaOAuth();
    expect(mocks.startMetaOAuthRequest).toHaveBeenCalledWith(COMPANY_ID, 'access-token-x', undefined);
  });

  it('erro de domínio (ex.: forbidden): resolve normalmente, nunca lança, NUNCA navega', async () => {
    mocks.startMetaOAuthRequest.mockResolvedValue({ outcome: 'domain_error', code: 'forbidden' });
    const navigate = vi.fn();
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: true, getAccessToken: getAccessTokenOk, navigate }),
      { wrapper },
    );
    const outcome = await result.current.startMetaOAuth();
    expect(outcome).toEqual({ outcome: 'domain_error', code: 'forbidden' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falha de rede (outcome error): resolve normalmente, NUNCA navega', async () => {
    mocks.startMetaOAuthRequest.mockResolvedValue({ outcome: 'error' });
    const navigate = vi.fn();
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useStartMetaOAuth({ companyId: COMPANY_ID, authorized: true, getAccessToken: getAccessTokenOk, navigate }),
      { wrapper },
    );
    const outcome = await result.current.startMetaOAuth();
    expect(outcome).toEqual({ outcome: 'error' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('getStartMetaOAuthErrorMessage', () => {
  it('nunca expõe código interno/backend — sempre a mensagem genérica pedida pela especificação', () => {
    expect(getStartMetaOAuthErrorMessage({ outcome: 'domain_error', code: 'forbidden' }))
      .toBe('Não foi possível iniciar a conexão com a Meta.');
    expect(getStartMetaOAuthErrorMessage({ outcome: 'domain_error', code: 'server_misconfigured' }))
      .toBe('Não foi possível iniciar a conexão com a Meta.');
    expect(getStartMetaOAuthErrorMessage({ outcome: 'error' }))
      .toBe('Não foi possível iniciar a conexão com a Meta.');
  });

  it('erros locais (sessão) têm mensagem própria', () => {
    expect(getStartMetaOAuthErrorMessage(new Error(START_META_OAUTH_LOCAL_ERRORS.missingSession)))
      .toBe('Sua sessão expirou. Entre novamente.');
  });
});
