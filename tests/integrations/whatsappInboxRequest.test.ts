// tests/integrations/whatsappInboxRequest.test.ts — W2B-8. Camada HTTP do cliente:
// Authorization, view-model fechado e erros. fetch mockado: nenhuma rede.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWhatsAppInboxConversations,
  fetchWhatsAppInboxMessages,
} from '@/lib/integrations/whatsappInboxRequest';

const COMPANY = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const ID = '33333333-3333-4333-8333-333333333333';
const JWT = 'fake.jwt.value';
const DATE = '2026-11-05T10:00:00.000Z';

const conversation = (over: Record<string, unknown> = {}) => ({
  id: ID,
  contact: { displayName: 'Fictício', phoneMasked: '+55 ••••• 1234', readable: true },
  lastMessageAt: DATE,
  messageCount: 2,
  preview: { kind: 'text', text: 'Oi', truncated: false },
  ...over,
});

const message = (over: Record<string, unknown> = {}) => ({
  id: ID, occurredAt: DATE, body: { kind: 'text', text: 'Oi', truncated: false }, ...over,
});

let fetchMock: ReturnType<typeof vi.spyOn>;

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

const listRequest = (cursor: string | null = null) => fetchWhatsAppInboxConversations({ companyId: COMPANY, cursor, accessToken: JWT });
const threadRequest = () => fetchWhatsAppInboxMessages({ companyId: COMPANY, conversationId: ID, cursor: null, accessToken: JWT });

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requisição', () => {
  it('usa GET, Bearer só no header e no-store', async () => {
    respond({ ok: true, conversations: [], nextCursor: null });
    await listRequest();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/integrations/whatsapp/inbox/conversations?company_id=${COMPANY}`);
    expect(url).not.toContain(JWT);
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${JWT}` } });
  });

  it('inclui o cursor quando informado', async () => {
    respond({ ok: true, conversations: [], nextCursor: null });
    await listRequest('abc_-1');
    expect(fetchMock.mock.calls[0][0]).toContain('cursor=abc_-1');
  });

  it('mensagens usam a rota da conversa', async () => {
    respond({ ok: true, messages: [], nextCursor: null });
    await threadRequest();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/integrations/whatsapp/inbox/conversations/${ID}/messages?company_id=${COMPANY}`);
  });
});

describe('view-model fechado', () => {
  it('descarta campos extras', async () => {
    respond({ ok: true, nextCursor: null, conversations: [conversation({ ciphertext: 'v1.a', wamid: 'x', contact: { displayName: null, phoneMasked: null, readable: false, phone: '5511' } })] });
    const result = await listRequest();
    expect(result).toEqual({
      outcome: 'ok',
      page: { nextCursor: null, conversations: [conversation({ contact: { displayName: null, phoneMasked: null, readable: false } })] },
    });
  });

  it('corpo de mídia descarta campos fora do contrato', async () => {
    respond({ ok: true, nextCursor: null, messages: [message({ body: { kind: 'media', mediaType: 'image', caption: null, fileName: null, mediaId: 'X' } })] });
    const result = await threadRequest();
    expect(result).toEqual({
      outcome: 'ok',
      page: { nextCursor: null, messages: [message({ body: { kind: 'media', mediaType: 'image', caption: null, fileName: null } })] },
    });
  });

  it.each([
    ['tipo de corpo desconhecido', conversation({ preview: { kind: 'html', text: '<b>' } })],
    ['mídia desconhecida', conversation({ preview: { kind: 'media', mediaType: 'pdf', caption: null, fileName: null } })],
    ['tipo não suportado fora do catálogo', conversation({ preview: { kind: 'unsupported', messageType: 'x' } })],
    ['data fora do formato', conversation({ lastMessageAt: 'ontem' })],
    ['id inválido', conversation({ id: 'x' })],
    ['contagem negativa', conversation({ messageCount: -1 })],
    ['contato sem readable', conversation({ contact: { displayName: null, phoneMasked: null } })],
  ])('%s invalida a página', async (_case, item) => {
    respond({ ok: true, conversations: [item], nextCursor: null });
    expect(await listRequest()).toEqual({ outcome: 'error' });
  });

  it('cursor fora do formato invalida a página', async () => {
    respond({ ok: true, conversations: [], nextCursor: 'a b' });
    expect(await listRequest()).toEqual({ outcome: 'error' });
  });
});

describe('erros', () => {
  it.each([
    ['inbox_disabled', 503],
    ['forbidden', 403],
    ['unauthenticated', 401],
    ['conversation_not_found', 404],
  ])('%s vira domain_error', async (code, status) => {
    respond({ ok: false, error: code }, status);
    expect(await threadRequest()).toEqual({ outcome: 'domain_error', code });
  });

  it.each([
    ['código fora do formato', { ok: false, error: 'Texto Livre com detalhe' }, 500],
    ['corpo que não é JSON', 'erro interno', 500],
    ['lista ausente', { ok: true }, 200],
    ['status de erro com ok true', { ok: true, conversations: [], nextCursor: null }, 500],
  ])('%s vira erro genérico', async (_case, body, status) => {
    respond(body, status);
    expect(await listRequest()).toEqual({ outcome: 'error' });
  });

  it('falha de rede vira erro genérico, sem lançar', async () => {
    fetchMock.mockRejectedValue(new Error(`detalhe ${JWT}`));
    expect(await listRequest()).toEqual({ outcome: 'error' });
  });
});
