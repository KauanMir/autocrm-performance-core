// tests/components/whatsappInbox/ScreenConversas.test.tsx — W2B-8. Tela da inbox:
// gates, estados, distinção de conteúdo, celular e ausência de dados sensíveis.
// Só dados fictícios. fetch mockado: nenhuma rede.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  context: { current: { companyId: null as string | null } },
  viewport: { current: { width: 1440, isSm: true, isMd: true, isLg: true, isDesktop: true } },
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession, getCurrentUser: m.getCurrentUser },
}));
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => m.context.current,
}));
vi.mock('@/lib/hooks/useViewport', () => ({ useViewport: () => m.viewport.current }));

import { ScreenConversas } from '@/components/whatsappInbox/ScreenConversas';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID } from '@/lib/capabilities';

const TEST_COMPANY = META_OAUTH_REVIEW_TEST_COMPANY_ID;
const PILOT_COMPANY = '22222222-2222-4222-8222-222222222222';
const JWT = 'fake.jwt.must-never-render-123456';
const ID_A = '33333333-3333-4333-8333-33333333333a';
const ID_B = '33333333-3333-4333-8333-33333333333b';
const MSG = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const TODAY = new Date(Date.now() - 60_000).toISOString();

const conversation = (over: Record<string, unknown> = {}) => ({
  id: ID_A,
  contact: { displayName: 'Cliente Fictício A', phoneMasked: '+55 ••••• 0001', readable: true },
  lastMessageAt: TODAY,
  messageCount: 2,
  preview: { kind: 'text', text: 'Prévia fictícia', truncated: false },
  ...over,
});

const message = (n: number, body: unknown, occurredAt = TODAY) => ({ id: MSG(n), occurredAt, body });

let fetchMock: ReturnType<typeof vi.spyOn>;

function arrange(options: { list?: unknown; listStatus?: number; thread?: unknown; threadStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const isThread = String(url).includes('/messages');
    const body = isThread
      ? (options.thread ?? { ok: true, nextCursor: null, messages: [message(1, { kind: 'text', text: 'Mensagem fictícia', truncated: false })] })
      : (options.list ?? { ok: true, nextCursor: null, conversations: [conversation()] });
    return new Response(JSON.stringify(body), { status: (isThread ? options.threadStatus : options.listStatus) ?? 200 });
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScreenConversas />
    </QueryClientProvider>,
  );
}

async function openConversation(name = 'Cliente Fictício A') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX', 'true');
  vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', '');
  m.context.current = { companyId: TEST_COMPANY };
  m.viewport.current = { width: 1440, isSm: true, isMd: true, isLg: true, isDesktop: true };
  m.getCurrentUser.mockReturnValue({ platformRole: 'super_admin', activeMembership: null });
  m.getSession.mockResolvedValue({ data: { session: { access_token: JWT } } });
  fetchMock = vi.spyOn(globalThis, 'fetch');
  arrange();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  m.getSession.mockReset();
  m.getCurrentUser.mockReset();
});

describe('acesso', () => {
  it.each([
    ['Manager', { platformRole: null, activeMembership: { role: 'manager', companyId: TEST_COMPANY } }],
    ['Seller', { platformRole: null, activeMembership: { role: 'seller', companyId: TEST_COMPANY } }],
    ['sem usuário', null],
  ])('%s não vê nada e nenhuma consulta é feita', async (_label, user) => {
    m.getCurrentUser.mockReturnValue(user);
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Super Admin em outra empresa não vê nada', () => {
    m.context.current = { companyId: PILOT_COMPANY };
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem empresa operacional não vê nada', () => {
    m.context.current = { companyId: null };
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flag desligada não vê nada', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX', 'false');
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Super Admin na TEST COMPANY consulta com Bearer, só no header', async () => {
    mount();
    await screen.findByTestId('whatsapp-inbox-conversation');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`company_id=${TEST_COMPANY}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
  });
});

describe('estados', () => {
  it('carregando', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.getByRole('status', { name: 'Carregando conversas' })).toBeInTheDocument();
  });

  it('vazio não é apresentado como erro', async () => {
    arrange({ list: { ok: true, conversations: [], nextCursor: null } });
    mount();
    expect(await screen.findByText('Nenhuma conversa ainda')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['inbox_disabled', 503, 'Caixa de entrada desativada'],
    ['inbox_unavailable', 503, 'Caixa de entrada indisponível'],
    ['forbidden', 403, 'Sem permissão'],
    ['unauthenticated', 401, 'Sessão expirada'],
  ])('%s tem mensagem própria', async (error, status, title) => {
    arrange({ list: { ok: false, error }, listStatus: status });
    mount();
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('sessão ausente não chama a API', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } });
    mount();
    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro genérico oferece nova tentativa, que funciona', async () => {
    fetchMock.mockRejectedValueOnce(new Error('falha detalhada interna'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as conversas.');
    expect(document.body.textContent).not.toContain('falha detalhada interna');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByTestId('whatsapp-inbox-conversation')).toBeInTheDocument();
  });

  it('erro do histórico fica no painel, e a lista segue visível', async () => {
    arrange({ thread: { ok: false, error: 'conversation_not_found' }, threadStatus: 404 });
    mount();
    await openConversation();
    expect(await screen.findByText('Conversa não encontrada')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-inbox-conversation')).toBeInTheDocument();
  });

  it('sem seleção, orienta a escolher e não consulta mensagens', async () => {
    mount();
    expect(await screen.findByText('Selecione uma conversa')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages'))).toEqual([]);
  });
});

describe('lista e histórico', () => {
  it('mostra contato, prévia e horário', async () => {
    mount();
    const row = await screen.findByTestId('whatsapp-inbox-conversation');
    expect(within(row).getByText('Cliente Fictício A')).toBeInTheDocument();
    expect(within(row).getByText('Prévia fictícia')).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('datetime', TODAY);
  });

  it.each([
    ['sem nome', { displayName: null, phoneMasked: '+55 ••••• 0002', readable: true }, '+55 ••••• 0002'],
    ['sem nome nem telefone', { displayName: null, phoneMasked: null, readable: true }, 'Contato sem identificação'],
    ['ilegível', { displayName: null, phoneMasked: null, readable: false }, 'Contato ilegível'],
  ])('contato %s tem identificação segura', async (_case, contact, label) => {
    arrange({ list: { ok: true, nextCursor: null, conversations: [conversation({ contact })] } });
    mount();
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('abre o histórico com separador de dia e aviso de somente leitura', async () => {
    mount();
    await openConversation();
    expect(await screen.findByText('Mensagem fictícia')).toBeInTheDocument();
    expect(screen.getByText('Hoje')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-inbox-readonly')).toHaveTextContent('Somente leitura');
  });

  it('não existe nenhum controle de envio', async () => {
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    expect(screen.queryByRole('textbox', { name: /mensagem/i })).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.queryByRole('button', { name: /enviar/i })).toBeNull();
  });

  it('texto, mídia, não suportado e ilegível são visualmente distintos', async () => {
    arrange({
      thread: {
        ok: true,
        nextCursor: null,
        messages: [
          message(1, { kind: 'text', text: 'Linha 1\nLinha 2', truncated: true }),
          message(2, { kind: 'media', mediaType: 'audio', caption: null, fileName: null }),
          message(3, { kind: 'media', mediaType: 'document', caption: 'Legenda fictícia', fileName: 'ficticio.pdf' }),
          message(4, { kind: 'unsupported', messageType: 'location' }),
          message(5, { kind: 'unsupported', messageType: 'other' }),
          message(6, { kind: 'unreadable' }),
        ],
      },
    });
    mount();
    await openConversation();

    const text = await screen.findByTestId('whatsapp-inbox-text');
    expect(text.textContent).toBe('Linha 1\nLinha 2');
    expect(screen.getByText('Mensagem longa: exibindo só o início.')).toBeInTheDocument();

    const media = screen.getAllByTestId('whatsapp-inbox-media');
    expect(media[0]).toHaveTextContent('Áudio recebido');
    expect(media[0]).toHaveTextContent('Arquivo ainda não disponível no CRM');
    expect(media[1]).toHaveTextContent('ficticio.pdf');
    expect(media[1]).toHaveTextContent('Documento ainda não disponível no CRM');
    expect(screen.getByText('Legenda fictícia')).toBeInTheDocument();

    const unsupported = screen.getAllByTestId('whatsapp-inbox-unsupported');
    expect(unsupported[0]).toHaveTextContent('Localização compartilhada');
    expect(unsupported[1]).toHaveTextContent('Tipo de mensagem não suportado');
    expect(screen.getByTestId('whatsapp-inbox-unreadable')).toHaveTextContent('Mensagem ilegível');
  });

  it('prévia de mídia sem legenda usa o tipo, e ilegível é identificada', async () => {
    arrange({
      list: {
        ok: true,
        nextCursor: null,
        conversations: [
          conversation({ preview: { kind: 'media', mediaType: 'image', caption: null, fileName: null } }),
          conversation({ id: ID_B, contact: { displayName: 'Cliente Fictício B', phoneMasked: null, readable: true }, preview: { kind: 'unreadable' } }),
        ],
      },
    });
    mount();
    expect(await screen.findByText('Imagem')).toBeInTheDocument();
    expect(screen.getByText('Mensagem ilegível')).toBeInTheDocument();
  });

  it('agrupa por dia, em ordem cronológica', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    arrange({
      thread: {
        ok: true,
        nextCursor: null,
        messages: [
          message(1, { kind: 'text', text: 'Fictícia de ontem', truncated: false }, yesterday),
          message(2, { kind: 'text', text: 'Fictícia de hoje', truncated: false }),
        ],
      },
    });
    mount();
    await openConversation();
    await screen.findByText('Fictícia de hoje');
    expect(screen.getAllByRole('separator').map((item) => item.textContent)).toEqual(['Ontem', 'Hoje']);
  });

  it('carrega mensagens anteriores antes das já exibidas', async () => {
    let page = 0;
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (!String(url).includes('/messages')) {
        return new Response(JSON.stringify({ ok: true, nextCursor: null, conversations: [conversation()] }));
      }
      page += 1;
      const body = page === 1
        ? { ok: true, nextCursor: 'cursor_antigo', messages: [message(2, { kind: 'text', text: 'Mais nova', truncated: false })] }
        : { ok: true, nextCursor: null, messages: [message(1, { kind: 'text', text: 'Mais antiga', truncated: false })] };
      return new Response(JSON.stringify(body));
    });
    mount();
    await openConversation();
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mensagens anteriores' }));
    await screen.findByText('Mais antiga');
    const bubbles = screen.getAllByTestId('whatsapp-inbox-text').map((item) => item.textContent);
    expect(bubbles).toEqual(['Mais antiga', 'Mais nova']);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=cursor_antigo');
  });

  it('carrega mais conversas', async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const more = String(url).includes('cursor=');
      return new Response(JSON.stringify(more
        ? { ok: true, nextCursor: null, conversations: [conversation({ id: ID_B, contact: { displayName: 'Cliente Fictício B', phoneMasked: null, readable: true } })] }
        : { ok: true, nextCursor: 'proxima', conversations: [conversation()] }));
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais conversas' }));
    expect(await screen.findByText('Cliente Fictício B')).toBeInTheDocument();
    expect(screen.getByText('Cliente Fictício A')).toBeInTheDocument();
  });

  it('Atualizar consulta de novo', async () => {
    mount();
    await screen.findByTestId('whatsapp-inbox-conversation');
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conversas' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('busca local', () => {
  const ID_C = '33333333-3333-4333-8333-33333333333c';
  const list = (over: Record<string, unknown> = {}) => ({
    ok: true,
    nextCursor: null,
    conversations: [
      conversation(),
      conversation({ id: ID_B, contact: { displayName: 'Cliente Fictício B', phoneMasked: '+55 ••••• 0002', readable: true }, preview: { kind: 'text', text: 'Quero um test drive', truncated: false } }),
      conversation({ id: ID_C, contact: { displayName: null, phoneMasked: '+55 ••••• 0003', readable: true } }),
    ],
    ...over,
  });
  const box = () => screen.findByRole('searchbox', { name: 'Buscar conversas' });
  const rows = () => screen.queryAllByTestId('whatsapp-inbox-conversation');
  const type = async (value: string) => fireEvent.change(await box(), { target: { value } });

  it('filtra por nome, telefone mascarado e prévia, sem nova consulta', async () => {
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');
    const calls = fetchMock.mock.calls.length;

    await type('ficticio b');
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('whatsapp-inbox-search-status')).toHaveTextContent('1 de 3 conversas');
    await type('0003');
    expect(rows()).toHaveLength(1);
    await type('test drive');
    expect(rows()).toHaveLength(1);
    await type('');
    expect(rows()).toHaveLength(3);

    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('não encontra texto do histórico que não está na prévia', async () => {
    arrange({ list: list() });
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    await type('Mensagem fictícia');
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('Nenhuma conversa encontrada')).toBeInTheDocument();
  });

  it('a resposta da API só traz telefone mascarado, e a busca não acrescenta nada à tela', async () => {
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');
    await type('0002');
    expect(rows()).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\d{7,}/);
    expect(document.body.textContent).not.toContain('0002');
  });

  it('o termo não vai para URL, armazenamento nem rede', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');
    await type('termo-sigiloso');
    expect(setLocal).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain('termo-sigiloso');
    expect(fetchMock.mock.calls.flat().map(String).join(' ')).not.toContain('termo-sigiloso');
  });

  it('termo hostil é só texto', async () => {
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');
    await type('<img src=x onerror=alert(1)>');
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('[data-testid=whatsapp-inbox-screen] img')).toBeNull();
  });

  it('o navegador não guarda nem corrige o termo', async () => {
    arrange({ list: list() });
    mount();
    const input = await box();
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input.closest('form')).toBeNull();
  });

  it('limpa pelo botão, pelo Esc e pelo estado vazio', async () => {
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');

    await type('sem resultado');
    const [insideField, inEmptyState] = screen.getAllByRole('button', { name: 'Limpar busca' });
    fireEvent.click(insideField);
    expect(rows()).toHaveLength(3);
    expect(await box()).toHaveFocus();
    expect(inEmptyState).not.toBeInTheDocument();

    await type('sem resultado');
    fireEvent.keyDown(await box(), { key: 'Escape' });
    expect(rows()).toHaveLength(3);

    await type('sem resultado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpar busca' })[1]);
    expect(rows()).toHaveLength(3);
  });

  it('filtrar não fecha a conversa aberta', async () => {
    arrange({ list: list() });
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    await type('Cliente Fictício B');
    expect(screen.getByTestId('whatsapp-inbox-thread')).toBeInTheDocument();
    expect(screen.getByText('Mensagem fictícia')).toBeInTheDocument();
  });

  it('com mais páginas, avisa que cobre só o carregado e não busca sozinha', async () => {
    arrange({ list: list({ nextCursor: 'cursor-ficticio' }) });
    mount();
    await screen.findByText('Cliente Fictício B');
    const calls = fetchMock.mock.calls.length;

    await type('sem resultado');
    expect(screen.getByText(/só as conversas já carregadas/)).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-inbox-search-status')).toHaveTextContent('0 de 3 conversas carregadas');
    expect(screen.getByRole('button', { name: 'Carregar mais conversas' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('não aparece quando não há conversas', async () => {
    arrange({ list: { ok: true, nextCursor: null, conversations: [] } });
    mount();
    await screen.findByText('Nenhuma conversa ainda');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('no celular, o termo continua ao voltar do histórico', async () => {
    m.viewport.current = { width: 390, isSm: false, isMd: false, isLg: false, isDesktop: false };
    arrange({ list: list() });
    mount();
    await screen.findByText('Cliente Fictício B');
    await type('Fictício A');
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await box()).toHaveValue('Fictício A');
    expect(rows()).toHaveLength(1);
  });
});

describe('avatares', () => {
  it('contatos parecidos têm tons diferentes, e o tom não muda ao abrir', async () => {
    arrange({
      list: {
        ok: true,
        nextCursor: null,
        conversations: [
          conversation(),
          conversation({ id: ID_B, contact: { displayName: 'Cliente Fictício B', phoneMasked: null, readable: true } }),
        ],
      },
    });
    mount();
    await screen.findByText('Cliente Fictício B');
    const [first, second] = screen.getAllByTestId('whatsapp-inbox-avatar');
    expect(first).toHaveTextContent('CA');
    expect(second).toHaveTextContent('CB');
    expect(first.style.background).not.toBe(second.style.background);

    await openConversation();
    const header = await screen.findByTestId('whatsapp-inbox-thread');
    expect(within(header).getByTestId('whatsapp-inbox-avatar').style.background).toBe(first.style.background);
  });

  it('sem nome usa ícone, e não uma imagem ou um ponto de interrogação', async () => {
    arrange({
      list: {
        ok: true,
        nextCursor: null,
        conversations: [
          conversation({ contact: { displayName: null, phoneMasked: '+55 ••••• 0001', readable: true } }),
          conversation({ id: ID_B, contact: { displayName: null, phoneMasked: null, readable: false } }),
        ],
      },
    });
    mount();
    await screen.findByText('Contato ilegível');
    for (const avatar of screen.getAllByTestId('whatsapp-inbox-avatar')) {
      expect(avatar.querySelector('svg')).not.toBeNull();
      expect(avatar.querySelector('img')).toBeNull();
      expect(avatar).not.toHaveTextContent('?');
    }
  });
});

describe('segurança na tela', () => {
  it('conteúdo hostil vira texto, nunca HTML', async () => {
    const hostile = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
    arrange({
      list: { ok: true, nextCursor: null, conversations: [conversation({ contact: { displayName: hostile, phoneMasked: null, readable: true } })] },
      thread: { ok: true, nextCursor: null, messages: [message(1, { kind: 'text', text: hostile, truncated: false })] },
    });
    mount();
    fireEvent.click(await screen.findByTestId('whatsapp-inbox-conversation'));
    expect(await screen.findByTestId('whatsapp-inbox-text')).toHaveTextContent(hostile);
    const thread = screen.getByTestId('whatsapp-inbox-thread');
    expect(thread.querySelector('img, script')).toBeNull();
    expect(screen.getByTestId('whatsapp-inbox-list').querySelector('img, script')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('o token nunca aparece na tela', async () => {
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    expect(document.body.innerHTML).not.toContain(JWT);
  });

  it('nada é gravado em localStorage ou sessionStorage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    expect(local).not.toHaveBeenCalled();
  });
});

describe('celular', () => {
  beforeEach(() => {
    m.viewport.current = { width: 390, isSm: false, isMd: false, isLg: false, isDesktop: false };
  });

  it('mostra um painel por vez e volta para a lista', async () => {
    mount();
    await openConversation();
    await screen.findByText('Mensagem fictícia');
    expect(screen.queryByTestId('whatsapp-inbox-list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await screen.findByTestId('whatsapp-inbox-list')).toBeInTheDocument();
    expect(screen.queryByTestId('whatsapp-inbox-thread')).toBeNull();
  });

  it('sem seleção, mostra só a lista', async () => {
    mount();
    await screen.findByTestId('whatsapp-inbox-list');
    expect(screen.queryByText('Selecione uma conversa')).toBeNull();
  });
});

describe('modo demonstração', () => {
  it('em teste nunca ativa, mesmo com a flag: consulta a API e não exibe aviso', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', 'true');
    mount();
    await screen.findByTestId('whatsapp-inbox-conversation');
    expect(screen.queryByTestId('whatsapp-inbox-demo-notice')).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('em desenvolvimento usa dados fictícios com aviso permanente e sem chamar a API', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', 'true');
    mount();
    expect(screen.getByTestId('whatsapp-inbox-demo-notice')).toHaveTextContent('dados fictícios');
    expect(await screen.findByText('Aurora Fictícia')).toBeInTheDocument();
    await openConversation('Aurora Fictícia');
    expect(await screen.findByTestId('whatsapp-inbox-demo-notice')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
