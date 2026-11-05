// tests/lib/server/whatsapp-inbox/inbox-view.test.ts — W2B-8. DTO fechado, máscara,
// falhas de decifragem e cursores. Envelopes reais com chave fictícia.
import { describe, expect, it } from 'vitest';
import {
  encryptWhatsAppContactPii,
  encryptWhatsAppMessageContent,
} from '@/lib/server/whatsapp-connection/capture-crypto';
import type { WhatsAppInboxConversationRow, WhatsAppInboxMessageRow } from '@/lib/server/whatsapp-inbox/inbox-rpc';
import {
  decodeConversationCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageCursor,
  maskWhatsAppPhone,
  toConversationView,
  toMessageView,
  WHATSAPP_INBOX_PREVIEW_LENGTH,
} from '@/lib/server/whatsapp-inbox/inbox-view';

const COMPANY = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const PII_REF = '66666666-6666-4666-8666-666666666666';
const HASH = 'b'.repeat(64);
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const OCCURRED = '2026-11-05T10:00:00.123456+00:00';

const content = (value: unknown, key = KEY, companyId = COMPANY) =>
  encryptWhatsAppMessageContent({
    companyId, connectionId: CONNECTION, messageIdHash: HASH, key,
    payload: { wamid: 'wamid.FICTICIO', content: value as never, repliedToWamid: 'wamid.RESPONDIDO' },
  });

const contact = (value: Record<string, unknown>, key = KEY) =>
  encryptWhatsAppContactPii({ companyId: COMPANY, piiRef: PII_REF, contact: value as never, key });

function messageRow(ciphertext: string, over: Partial<WhatsAppInboxMessageRow> = {}): WhatsAppInboxMessageRow {
  return {
    messageId: MESSAGE, connectionId: CONNECTION, messageType: 'text', messageIdHash: HASH,
    contentCiphertext: ciphertext, contentKeyVersion: 1, occurredAt: OCCURRED, receivedAt: OCCURRED, ...over,
  };
}

function conversationRow(over: Partial<WhatsAppInboxConversationRow> = {}): WhatsAppInboxConversationRow {
  return {
    conversationId: CONVERSATION,
    lastMessageAt: OCCURRED,
    messageCount: 1,
    piiCiphertext: contact({ phone: '5511900001234', bsuid: null, parentBsuid: null, displayName: 'Fictício' }),
    piiRef: PII_REF,
    piiKeyVersion: 1,
    lastConnectionId: CONNECTION,
    lastMessageType: 'text',
    lastMessageIdHash: HASH,
    lastContentCiphertext: content({ kind: 'text', text: 'Olá', truncated: false }),
    lastContentKeyVersion: 1,
    ...over,
  };
}

describe('maskWhatsAppPhone', () => {
  it.each([
    ['5511900001234', '+55 ••••• 1234'],
    ['14155550100', '+14 ••••• 0100'],
    ['1234567', '+12 ••••• 4567'],
  ])('%s → %s', (phone, masked) => {
    expect(maskWhatsAppPhone(phone)).toBe(masked);
  });

  it.each([[null], [undefined], [''], ['123456'], ['+5511900001234'], ['abc'], [5511900001234]])('%s → null', (value) => {
    expect(maskWhatsAppPhone(value)).toBeNull();
  });

  it('nunca revela os dígitos do meio', () => {
    expect(maskWhatsAppPhone('5511900001234')).not.toContain('90000');
  });
});

describe('toConversationView', () => {
  it('não copia BSUID, telefone completo nem IDs internos', () => {
    const view = toConversationView(
      conversationRow({ piiCiphertext: contact({ phone: '5511900001234', bsuid: 'BR.FICTICIO', parentBsuid: 'BR.ENT.FICTICIO', displayName: 'Fictício' }) }),
      COMPANY, KEY,
    );
    expect(Object.keys(view).sort()).toEqual(['contact', 'id', 'lastMessageAt', 'messageCount', 'preview']);
    expect(Object.keys(view.contact).sort()).toEqual(['displayName', 'phoneMasked', 'readable']);
    expect(JSON.stringify(view)).not.toMatch(/BR\.|5511900001234|wamid/);
  });

  it('nome com controle e marcas de direção é limpo', () => {
    const view = toConversationView(
      conversationRow({ piiCiphertext: contact({ phone: null, bsuid: 'BR.X', parentBsuid: null, displayName: 'Nome\u202e\u0007  Falso\n' }) }),
      COMPANY, KEY,
    );
    expect(view.contact.displayName).toBe('Nome Falso');
  });

  it('nome só de espaços vira null', () => {
    const view = toConversationView(
      conversationRow({ piiCiphertext: contact({ phone: null, bsuid: 'BR.X', parentBsuid: null, displayName: ' \u200e ' }) }),
      COMPANY, KEY,
    );
    expect(view.contact.displayName).toBeNull();
  });

  it.each([
    ['chave errada', () => ({ piiCiphertext: contact({ phone: '5511900001234' }, OTHER_KEY) })],
    ['envelope corrompido', () => ({ piiCiphertext: 'v1.a.b.c' })],
    ['versão desconhecida', () => ({ piiKeyVersion: 2 })],
    ['outra referência', () => ({ piiRef: '66666666-6666-4666-8666-000000000000' })],
  ])('%s → contato ilegível, sem derrubar a página', (_case, over) => {
    const view = toConversationView(conversationRow(over()), COMPANY, KEY);
    expect(view.contact).toEqual({ displayName: null, phoneMasked: null, readable: false });
    expect(view.preview.kind).toBe('text');
  });

  it('envelope de outra empresa não decifra aqui', () => {
    const view = toConversationView(conversationRow(), OTHER_COMPANY, KEY);
    expect(view.contact.readable).toBe(false);
    expect(view.preview).toEqual({ kind: 'unreadable' });
  });

  it('prévia corta em caracteres inteiros e achata quebras de linha', () => {
    const text = `${'🚗'.repeat(WHATSAPP_INBOX_PREVIEW_LENGTH)}fim`;
    const view = toConversationView(
      conversationRow({ lastContentCiphertext: content({ kind: 'text', text, truncated: false }) }), COMPANY, KEY,
    );
    expect(view.preview).toEqual({ kind: 'text', text: `${'🚗'.repeat(WHATSAPP_INBOX_PREVIEW_LENGTH)}…`, truncated: false });

    const flat = toConversationView(
      conversationRow({ lastContentCiphertext: content({ kind: 'text', text: 'linha 1\n\n  linha 2', truncated: false }) }), COMPANY, KEY,
    );
    expect(flat.preview).toMatchObject({ text: 'linha 1 linha 2' });
  });
});

describe('toMessageView', () => {
  it('texto: mantém quebras de linha e o aviso de corte', () => {
    const view = toMessageView(messageRow(content({ kind: 'text', text: 'a\nb', truncated: true })), COMPANY, KEY);
    expect(view).toEqual({ id: MESSAGE, occurredAt: '2026-11-05T10:00:00.123Z', body: { kind: 'text', text: 'a\nb', truncated: true } });
  });

  it('mídia: nunca devolve mediaId, mime ou sha256', () => {
    const view = toMessageView(
      messageRow(content({ kind: 'media', mediaType: 'document', mediaId: 'ID', mimeType: 'application/pdf', sha256: 'SHA', caption: ' ', fileName: 'a.pdf' })),
      COMPANY, KEY,
    );
    expect(view.body).toEqual({ kind: 'media', mediaType: 'document', caption: null, fileName: 'a.pdf' });
  });

  it.each(['location', 'contacts', 'reaction', 'system', 'request_welcome', 'order', 'button', 'interactive'])(
    'tipo %s fica identificado',
    (messageType) => {
      const view = toMessageView(messageRow(content({ kind: 'unsupported' }), { messageType }), COMPANY, KEY);
      expect(view.body).toEqual({ kind: 'unsupported', messageType });
    },
  );

  it('tipo fora do catálogo vira other', () => {
    const view = toMessageView(messageRow(content({ kind: 'unsupported' }), { messageType: 'novo_tipo' }), COMPANY, KEY);
    expect(view.body).toEqual({ kind: 'unsupported', messageType: 'other' });
  });

  it.each([
    ['chave errada', () => messageRow(content({ kind: 'text', text: 'x' }, OTHER_KEY))],
    ['envelope corrompido', () => messageRow('v1.a.b.c')],
    ['outra conexão', () => messageRow(content({ kind: 'text', text: 'x' }), { connectionId: '44444444-4444-4444-8444-000000000000' })],
    ['outro hash', () => messageRow(content({ kind: 'text', text: 'x' }), { messageIdHash: 'c'.repeat(64) })],
    ['versão desconhecida', () => messageRow(content({ kind: 'text', text: 'x' }), { contentKeyVersion: 2 })],
    ['payload sem conteúdo', () => messageRow(content(null))],
    ['kind desconhecido', () => messageRow(content({ kind: 'novo' }))],
    ['texto que não é string', () => messageRow(content({ kind: 'text', text: 1 }))],
    ['mídia desconhecida', () => messageRow(content({ kind: 'media', mediaType: 'pdf' }))],
  ])('%s → ilegível', (_case, row) => {
    expect(toMessageView(row(), COMPANY, KEY).body).toEqual({ kind: 'unreadable' });
  });
});

describe('cursores', () => {
  it('conversa: ida e volta', () => {
    const row = conversationRow();
    expect(decodeConversationCursor(encodeConversationCursor(row))).toEqual({ lastMessageAt: OCCURRED, id: CONVERSATION });
  });

  it('mensagem: ida e volta', () => {
    const row = messageRow('x');
    expect(decodeMessageCursor(encodeMessageCursor(row))).toEqual({ occurredAt: OCCURRED, receivedAt: OCCURRED, id: MESSAGE });
  });

  it('cursor contém só posição: nada de conteúdo ou contato', () => {
    const decoded = Buffer.from(encodeConversationCursor(conversationRow()), 'base64url').toString('utf8');
    expect(JSON.parse(decoded)).toEqual([OCCURRED, CONVERSATION]);
  });

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  it.each([
    ['caracteres inválidos', '***'],
    ['JSON inválido', Buffer.from('{').toString('base64url')],
    ['objeto', encode({ a: 1 })],
    ['tamanho errado', encode([OCCURRED])],
    ['tipo errado', encode([1, 2])],
    ['data inválida', encode(['ontem', CONVERSATION])],
    ['UUID inválido', encode([OCCURRED, 'x'])],
    ['injeção', encode([`${OCCURRED}'; drop table x; --`, CONVERSATION])],
    ['longo demais', 'a'.repeat(300)],
  ])('%s → null', (_case, cursor) => {
    expect(decodeConversationCursor(cursor)).toBeNull();
  });

  it('cursor de conversa não vale como cursor de mensagem', () => {
    expect(decodeMessageCursor(encodeConversationCursor(conversationRow()))).toBeNull();
  });
});
