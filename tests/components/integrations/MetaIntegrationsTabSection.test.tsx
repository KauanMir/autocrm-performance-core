// tests/components/integrations/MetaIntegrationsTabSection.test.tsx —
// META-OAUTH-REVIEW-UI. useStartMetaOAuth e fetchMetaReviewStatusRequest
// mockados — nenhuma rede real, nenhum comportamento de hook re-testado
// aqui (useStartMetaOAuth tem cobertura própria em
// tests/hooks/useStartMetaOAuth.test.tsx).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useStartMetaOAuth: vi.fn(),
  startMetaOAuthMock: vi.fn(),
  getSession: vi.fn(),
  fetchMetaReviewStatusRequest: vi.fn(),
}));

vi.mock('@/lib/hooks/useStartMetaOAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useStartMetaOAuth')>();
  return { ...actual, useStartMetaOAuth: m.useStartMetaOAuth };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession },
}));

vi.mock('@/lib/integrations/metaReviewStatusRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/metaReviewStatusRequest')>();
  return { ...actual, fetchMetaReviewStatusRequest: m.fetchMetaReviewStatusRequest };
});

import { MetaIntegrationsTabSection } from '@/components/integrations/MetaIntegrationsTabSection';

const COMPANY_ID = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const ACCESS_TOKEN = 'fake-access-token-must-never-render';

beforeEach(() => {
  window.history.pushState(null, '', `/company/${COMPANY_ID}`);
  m.startMetaOAuthMock.mockReset();
  m.startMetaOAuthMock.mockResolvedValue({ outcome: 'ok', authorizationUrl: 'https://www.facebook.com/dialog/oauth' });
  m.useStartMetaOAuth.mockReturnValue({ startMetaOAuth: m.startMetaOAuthMock, isPending: false, reset: vi.fn() });
  m.getSession.mockReset();
  m.getSession.mockResolvedValue({ data: { session: { access_token: ACCESS_TOKEN } } });
  m.fetchMetaReviewStatusRequest.mockReset();
});

afterEach(() => {
  window.history.pushState(null, '', '/');
});

describe('MetaIntegrationsTabSection — estado inicial (sem meta_review na URL)', () => {
  it('mostra título, descrição e o botão "Conectar Meta"', () => {
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    expect(screen.getByText('Meta Lead Ads')).toBeInTheDocument();
    expect(screen.getByText(/Conecte sua Página do Facebook para autorizar/)).toBeInTheDocument();
    expect(screen.getByText('Conectar Meta')).toBeInTheDocument();
  });

  it('não mostra o estado de sucesso nem chama a verificação de status', () => {
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    expect(screen.queryByTestId('meta-integration-verified')).toBeNull();
    expect(m.fetchMetaReviewStatusRequest).not.toHaveBeenCalled();
  });
});

describe('MetaIntegrationsTabSection — clicar "Conectar Meta"', () => {
  it('chama startMetaOAuth (que por sua vez usa o /start existente — coberto em useStartMetaOAuth.test.tsx)', async () => {
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    screen.getByText('Conectar Meta').click();
    await waitFor(() => expect(m.startMetaOAuthMock).toHaveBeenCalledTimes(1));
  });

  it('resultado domain_error (ex.: forbidden): mostra mensagem genérica sanitizada, nunca o código interno', async () => {
    m.startMetaOAuthMock.mockResolvedValue({ outcome: 'domain_error', code: 'forbidden' });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    screen.getByText('Conectar Meta').click();
    await waitFor(() => expect(screen.getByTestId('meta-integration-start-error')).toBeInTheDocument());
    expect(screen.getByTestId('meta-integration-start-error')).toHaveTextContent('Não foi possível iniciar a conexão com a Meta.');
    expect(document.body.innerHTML).not.toMatch(/forbidden/);
  });

  it('rejeição local (sessão expirada): mostra mensagem sanitizada específica', async () => {
    m.startMetaOAuthMock.mockRejectedValue(new Error('start-meta-oauth-missing-session'));
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    screen.getByText('Conectar Meta').click();
    await waitFor(() => expect(screen.getByTestId('meta-integration-start-error')).toHaveTextContent('Sua sessão expirou. Entre novamente.'));
  });
});

describe('MetaIntegrationsTabSection — retorno do callback (meta_review na URL)', () => {
  it('com `meta_review` na URL: verifica o status, mostra "Autorização Meta validada" e os 4 itens ao suceder', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: false,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);

    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    expect(screen.getByText('Autorização Meta validada')).toBeInTheDocument();
    expect(screen.getByText('KAPA CRM Teste')).toBeInTheDocument();
    expect(screen.getByText('pages_show_list: Validado')).toBeInTheDocument();
    expect(screen.getByText('pages_read_engagement: Validado')).toBeInTheDocument();
    expect(screen.getByText('pages_manage_metadata: Validado')).toBeInTheDocument();
    expect(screen.getByText('leads_retrieval: Validado')).toBeInTheDocument();
    expect(screen.getByText('leadgen webhook: Assinado')).toBeInTheDocument();
  });

  it('nunca usa linguagem de persistência permanente ("conectado definitivamente"/"token salvo")', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: false,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    const html = document.body.innerHTML.toLowerCase();
    expect(html).not.toMatch(/integração permanente/);
    expect(html).not.toMatch(/token salvo/);
    expect(html).not.toMatch(/conectado definitivamente/);
  });

  it('limpa `meta_review` da URL imediatamente (token de uso único, nunca sobrevive a um F5)', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: false,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('meta_review')).toBe(false));
  });

  it('token inválido/expirado (domain_error do review-status): mostra erro sanitizado, NUNCA "verificado"', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({ outcome: 'domain_error', code: 'token_invalid' });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-status-error')).toBeInTheDocument());
    expect(screen.queryByTestId('meta-integration-verified')).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/token_invalid/);
  });

  it('sem sessão válida ao verificar: mostra erro de sessão, nunca chama fetchMetaReviewStatusRequest', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.getSession.mockResolvedValue({ data: { session: null } });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-status-error')).toHaveTextContent('Sua sessão expirou. Entre novamente.'));
    expect(m.fetchMetaReviewStatusRequest).not.toHaveBeenCalled();
  });
});

describe('MetaIntegrationsTabSection — sem segredo no client, sem persistência', () => {
  it('o JWT/access token nunca aparece no HTML renderizado', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: false,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(ACCESS_TOKEN);
    expect(document.body.innerHTML).not.toContain('signed-token-abc');
  });

  it('nunca escreve em localStorage/sessionStorage (nenhuma persistência falsa do estado de sucesso)', async () => {
    const localSpy = vi.spyOn(Storage.prototype, 'setItem');
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-abc`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: false,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    expect(localSpy).not.toHaveBeenCalled();
  });
});

describe('MetaIntegrationsTabSection — persistência P4B (review result)', () => {
  it('sucesso com persistência: mostra "Conexão persistida com segurança" e os quatro itens validados', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-persisted`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: true,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    expect(screen.getByText('Conexão persistida com segurança')).toBeInTheDocument();
    expect(screen.getByText('leads_retrieval: Validado')).toBeInTheDocument();
    expect(screen.queryByText('Fluxo de teste concluído. O token não é salvo nesta etapa.')).toBeNull();
  });

  it('falha de persistência genérica: mensagem amigável, sem status de sucesso', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-fail`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'failure',
      failureCode: 'connection_persist_failed',
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-persist-failed')).toBeInTheDocument());
    expect(screen.getByText('Não foi possível concluir a conexão Meta. Tente conectar novamente.')).toBeInTheDocument();
    expect(screen.queryByTestId('meta-integration-verified')).toBeNull();
  });

  it('page_already_connected: informa sem revelar dados de outra company', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-conflict`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'failure',
      failureCode: 'page_already_connected',
    });
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByText('Esta Página já está vinculada a outra empresa no CRM.')).toBeInTheDocument());
    expect(document.body.textContent ?? '').not.toMatch(/ciphertext|access_token|v1\.|SQL|DETAIL/);
  });

  it('refresh depois do retorno: a URL já foi limpa, a tela volta para Conectar Meta', async () => {
    window.history.pushState(null, '', `/company/${COMPANY_ID}?meta_review=signed-token-once`);
    m.fetchMetaReviewStatusRequest.mockResolvedValue({
      outcome: 'ok',
      reviewOutcome: 'success',
      persisted: true,
      stage: 'test_page_permissions_verified',
      page: { matched: true, advertiseTaskPresent: true, readEngagementVerified: true },
      pageSubscription: { verified: true, field: 'leadgen' },
    });
    const { unmount } = render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    await waitFor(() => expect(screen.getByTestId('meta-integration-verified')).toBeInTheDocument());
    unmount();
    expect(new URL(window.location.href).searchParams.has('meta_review')).toBe(false);
    render(<MetaIntegrationsTabSection companyId={COMPANY_ID} />);
    expect(screen.queryByTestId('meta-integration-verified')).toBeNull();
    expect(screen.getByText('Conectar Meta')).toBeInTheDocument();
  });
});
