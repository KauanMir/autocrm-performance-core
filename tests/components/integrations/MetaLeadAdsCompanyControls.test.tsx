// META-MVP2 — controles de Lead Ads por empresa. Hooks reais com QueryClient
// real; só as requisições (lib/integrations/metaLeadOps) e a sessão são fakes.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  fetchAccess: vi.fn(),
  setAccess: vi.fn(),
  fetchPages: vi.fn(),
  selectPage: vi.fn(),
  fetchUnrouted: vi.fn(),
  adopt: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/services', () => ({ AuthService: { getSession: m.getSession } }));
vi.mock('@/lib/integrations/metaLeadOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/metaLeadOps')>()),
  fetchMetaLeadAdsAccess: m.fetchAccess,
  setMetaLeadAdsAccess: m.setAccess,
  fetchSelectablePagesRequest: m.fetchPages,
  selectPageRequest: m.selectPage,
  fetchMetaUnroutedEvents: m.fetchUnrouted,
  adoptMetaUnroutedRequest: m.adopt,
}));

import { MetaLeadAdsAccessToggle, MetaPageSelectionPanel, MetaUnroutedEventsPanel, pageSelectionErrorMessage } from '@/components/integrations/MetaLeadAdsCompanyControls';
import { MetaLeadOpsError, MetaPageSelectionError } from '@/lib/integrations/metaLeadOps';

const COMPANY = 'company-a';
const PAGES = [{ pageId: '111', pageName: 'Loja Centro' }, { pageId: '222', pageName: 'Loja Sul' }];

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/company/${COMPANY}${search}`);
}

beforeEach(() => {
  m.getSession.mockResolvedValue({ data: { session: { access_token: 'session-jwt' } } });
  m.fetchAccess.mockReset();
  m.setAccess.mockReset();
  m.fetchPages.mockReset();
  m.selectPage.mockReset();
  m.fetchUnrouted.mockReset();
  m.adopt.mockReset();
  setUrl('');
});

afterEach(() => setUrl(''));

describe('MetaLeadAdsAccessToggle', () => {
  it('carregando: sem badge e sem botão', () => {
    m.fetchAccess.mockReturnValue(new Promise(() => {}));
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('desabilitada: mostra o estado e habilita ao clicar', async () => {
    m.fetchAccess.mockResolvedValue(false);
    m.setAccess.mockResolvedValue(true);
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    expect(await screen.findByText('Desabilitado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Habilitar' }));
    await waitFor(() => expect(m.setAccess).toHaveBeenCalledWith(COMPANY, true));
  });

  it('habilitada: oferece desabilitar', async () => {
    m.fetchAccess.mockResolvedValue(true);
    m.setAccess.mockResolvedValue(false);
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    expect(await screen.findByText('Habilitado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desabilitar' }));
    await waitFor(() => expect(m.setAccess).toHaveBeenCalledWith(COMPANY, false));
  });

  it('leitura falhou: avisa e NÃO oferece ação às cegas', async () => {
    m.fetchAccess.mockRejectedValue(new MetaLeadOpsError('unavailable'));
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler a habilitação');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Desabilitado')).toBeNull();
  });

  it('empresa que não está ativa: mensagem específica', async () => {
    m.fetchAccess.mockResolvedValue(false);
    m.setAccess.mockRejectedValue(new MetaLeadOpsError('company_not_active'));
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Habilitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A empresa precisa estar ativa');
  });

  it('banco recusou: mensagem genérica, sem detalhe', async () => {
    m.fetchAccess.mockResolvedValue(false);
    m.setAccess.mockRejectedValue(new MetaLeadOpsError('forbidden'));
    wrap(<MetaLeadAdsAccessToggle companyId={COMPANY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Habilitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível alterar a habilitação.');
  });
});

describe('MetaPageSelectionPanel', () => {
  it('sem o marcador: não renderiza nem consulta nada', () => {
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    expect(screen.queryByTestId('meta-page-selection')).toBeNull();
    expect(m.fetchPages).not.toHaveBeenCalled();
  });

  it('com o marcador: limpa a URL e lista só os nomes das Páginas', async () => {
    setUrl('?meta_select=1&outro=x');
    m.fetchPages.mockResolvedValue(PAGES);
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    expect(await screen.findByLabelText('Loja Centro')).toBeInTheDocument();
    expect(screen.getByLabelText('Loja Sul')).toBeInTheDocument();
    expect(window.location.search).toBe('?outro=x');
    expect(m.fetchPages).toHaveBeenCalledWith('session-jwt');
  });

  it('carregando: mostra o estado de espera', async () => {
    setUrl('?meta_select=1');
    m.fetchPages.mockReturnValue(new Promise(() => {}));
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    expect(await screen.findByText('Carregando Páginas autorizadas…')).toBeInTheDocument();
  });

  it('sem escolher uma Página, o botão não conecta', async () => {
    setUrl('?meta_select=1');
    m.fetchPages.mockResolvedValue(PAGES);
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    await screen.findByLabelText('Loja Centro');
    fireEvent.click(screen.getByRole('button', { name: 'Conectar esta Página' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.selectPage).not.toHaveBeenCalled();
  });

  it('conecta só a Página escolhida e mostra a confirmação', async () => {
    setUrl('?meta_select=1');
    m.fetchPages.mockResolvedValue(PAGES);
    m.selectPage.mockResolvedValue(PAGES[1]);
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByLabelText('Loja Sul'));
    fireEvent.click(screen.getByRole('button', { name: 'Conectar esta Página' }));
    expect(await screen.findByTestId('meta-page-connected')).toHaveTextContent('Loja Sul passa a enviar os leads');
    expect(m.selectPage).toHaveBeenCalledTimes(1);
    expect(m.selectPage).toHaveBeenCalledWith('222', 'session-jwt');
  });

  it.each([
    ['selection_expired', 'A seleção expirou'],
    ['selection_unavailable', 'não está mais disponível'],
    ['forbidden', 'não tem permissão'],
    ['company_access_disabled', 'não está habilitado'],
  ])('erro ao listar (%s): avisa e não mostra Páginas', async (code, text) => {
    setUrl('?meta_select=1');
    m.fetchPages.mockRejectedValue(new MetaPageSelectionError(code));
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it.each([
    ['page_already_connected', 'já está vinculada a outra empresa'],
    ['page_not_offered', 'não estava entre as autorizadas'],
    ['connection_lookup_failed', 'Tente de novo'],
  ])('falha que não consome a seleção (%s): a lista continua para escolher outra', async (code, text) => {
    setUrl('?meta_select=1');
    m.fetchPages.mockResolvedValue(PAGES);
    m.selectPage.mockRejectedValue(new MetaPageSelectionError(code));
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByLabelText('Loja Centro'));
    fireEvent.click(screen.getByRole('button', { name: 'Conectar esta Página' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it.each([
    ['selection_already_used', 'já foi usada'],
    ['selection_expired', 'A seleção expirou'],
    ['page_token_invalid', 'não confirmou a credencial'],
    ['page_subscription_failed', 'Conecte a Meta novamente'],
    ['connection_persist_failed', 'ficam guardados'],
  ])('falha com a seleção consumida (%s): some a lista e orienta um novo OAuth', async (code, text) => {
    setUrl('?meta_select=1');
    m.fetchPages.mockResolvedValue(PAGES);
    m.selectPage.mockRejectedValue(new MetaPageSelectionError(code));
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByLabelText('Loja Centro'));
    fireEvent.click(screen.getByRole('button', { name: 'Conectar esta Página' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conectar esta Página' })).toBeNull();
  });

  it('código desconhecido nunca é exibido cru', () => {
    const message = pageSelectionErrorMessage(new MetaPageSelectionError('sql_error_detail'));
    expect(message).not.toContain('sql_error_detail');
    expect(message).toContain('Conecte a Meta novamente');
    expect(pageSelectionErrorMessage(new Error('qualquer'))).toContain('Tente de novo');
  });
});

describe('MetaUnroutedEventsPanel', () => {
  const group = (over = {}) => ({
    pageId: '333', reason: 'no_connection', pending: 2, firstReceivedAt: null, lastReceivedAt: null, canAdopt: false, ...over,
  });

  it('sem eventos retidos: não ocupa espaço na tela', async () => {
    m.fetchUnrouted.mockResolvedValue([]);
    const { container } = wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    await waitFor(() => expect(m.fetchUnrouted).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('erro ao ler: avisa, sem omitir que pode haver evento retido', async () => {
    m.fetchUnrouted.mockRejectedValue(new MetaLeadOpsError('unavailable'));
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler os eventos retidos');
  });

  it('Página de ninguém: mostra quantidade e motivo, sem botão de liberar', async () => {
    m.fetchUnrouted.mockResolvedValue([group()]);
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    expect(await screen.findByText('2 eventos')).toBeInTheDocument();
    expect(screen.getByText('Página sem conexão ativa')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('motivos da mesma Página são somados numa linha', async () => {
    m.fetchUnrouted.mockResolvedValue([group({ pending: 1, canAdopt: true }), group({ pending: 3, reason: 'company_disabled', canAdopt: true })]);
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    expect(await screen.findByText('4 eventos')).toBeInTheDocument();
    expect(screen.getAllByTestId('meta-unrouted-page')).toHaveLength(1);
    expect(screen.getByText('Página sem conexão ativa · Empresa desabilitada')).toBeInTheDocument();
  });

  it('libera para a empresa aberta e informa a quantidade', async () => {
    m.fetchUnrouted.mockResolvedValue([group({ canAdopt: true })]);
    m.adopt.mockResolvedValue({ outcome: 'adopted', adopted: 2, processingScheduled: true });
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar para esta empresa' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Liberados para esta empresa: 2.');
    expect(m.adopt).toHaveBeenCalledWith(COMPANY, '333', 'session-jwt');
  });

  it.each([
    ['owner_conflict', 'vinculada a outra empresa'],
    ['company_disabled', 'Habilite o Lead Ads'],
    ['not_connected', 'não está conectada a esta empresa'],
  ])('recusa do banco (%s): explica o motivo', async (outcome, text) => {
    m.fetchUnrouted.mockResolvedValue([group({ canAdopt: true })]);
    m.adopt.mockResolvedValue({ outcome, adopted: 0, processingScheduled: false });
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar para esta empresa' }));
    expect(await screen.findByRole('status')).toHaveTextContent(text);
  });

  it('falha ao liberar: avisa sem esconder os eventos', async () => {
    m.fetchUnrouted.mockResolvedValue([group({ canAdopt: true })]);
    m.adopt.mockRejectedValue(new MetaLeadOpsError('unavailable'));
    wrap(<MetaUnroutedEventsPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar para esta empresa' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível liberar');
    expect(screen.getByText('2 eventos')).toBeInTheDocument();
  });
});

describe('volta do OAuth com falha', () => {
  it.each([
    ['provider_error', 'foi cancelada'],
    ['missing_required_permission', 'Faltou autorizar'],
    ['no_eligible_page', 'Nenhuma Página com permissão'],
  ])('%s: mostra o aviso e limpa a URL', async (code, text) => {
    setUrl(`?meta_error=${code}`);
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(window.location.search).toBe('');
    expect(m.fetchPages).not.toHaveBeenCalled();
  });

  it('código fora do catálogo: mensagem genérica, nunca o valor da URL', async () => {
    setUrl('?meta_error=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    wrap(<MetaPageSelectionPanel companyId={COMPANY} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível concluir a conexão com a Meta');
    expect(alert.textContent).not.toContain('script');
  });
});
