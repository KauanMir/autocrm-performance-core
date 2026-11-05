// lib/integrations/whatsappInboxRequest.ts — camada HTTP client-safe da inbox WhatsApp
// (W2B-8). Mesmo molde de whatsappDiagnosticsRequest.ts: roda no browser, nunca importa
// lib/server/* e nunca lança exceção com token. A resposta vira um view-model fechado:
// campo extra é ignorado e valor fora do catálogo invalida a página.
export const WHATSAPP_INBOX_MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
export type WhatsAppInboxMediaType = (typeof WHATSAPP_INBOX_MEDIA_TYPES)[number];

export const WHATSAPP_INBOX_UNSUPPORTED_TYPES = [
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive',
  'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported', 'other',
] as const;
export type WhatsAppInboxMessageType = (typeof WHATSAPP_INBOX_UNSUPPORTED_TYPES)[number];

export type WhatsAppInboxBody =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'media'; mediaType: WhatsAppInboxMediaType; caption: string | null; fileName: string | null }
  | { kind: 'unsupported'; messageType: WhatsAppInboxMessageType }
  | { kind: 'unreadable' };

export type WhatsAppInboxContact = {
  displayName: string | null;
  phoneMasked: string | null;
  readable: boolean;
};

export type WhatsAppInboxConversation = {
  id: string;
  contact: WhatsAppInboxContact;
  lastMessageAt: string;
  messageCount: number;
  preview: WhatsAppInboxBody;
};

export type WhatsAppInboxMessage = {
  id: string;
  occurredAt: string;
  body: WhatsAppInboxBody;
};

export type WhatsAppInboxConversationsPage = { conversations: WhatsAppInboxConversation[]; nextCursor: string | null };
export type WhatsAppInboxMessagesPage = { messages: WhatsAppInboxMessage[]; nextCursor: string | null };

export type WhatsAppInboxResult<T> =
  | { outcome: 'ok'; page: T }
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

const SNAKE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function parseBody(value: unknown): WhatsAppInboxBody | null {
  if (!isPlainObject(value)) return null;
  if (value.kind === 'text') {
    return typeof value.text === 'string' ? { kind: 'text', text: value.text, truncated: value.truncated === true } : null;
  }
  if (value.kind === 'media') {
    const mediaType = WHATSAPP_INBOX_MEDIA_TYPES.find((candidate) => candidate === value.mediaType);
    const caption = textOrNull(value.caption);
    const fileName = textOrNull(value.fileName);
    return mediaType && caption !== undefined && fileName !== undefined ? { kind: 'media', mediaType, caption, fileName } : null;
  }
  if (value.kind === 'unsupported') {
    const messageType = WHATSAPP_INBOX_UNSUPPORTED_TYPES.find((candidate) => candidate === value.messageType);
    return messageType ? { kind: 'unsupported', messageType } : null;
  }
  return value.kind === 'unreadable' ? { kind: 'unreadable' } : null;
}

function parseContact(value: unknown): WhatsAppInboxContact | null {
  if (!isPlainObject(value)) return null;
  const displayName = textOrNull(value.displayName);
  const phoneMasked = textOrNull(value.phoneMasked);
  if (displayName === undefined || phoneMasked === undefined || typeof value.readable !== 'boolean') return null;
  return { displayName, phoneMasked, readable: value.readable };
}

function parseConversation(value: unknown): WhatsAppInboxConversation | null {
  if (!isPlainObject(value)) return null;
  const { id, lastMessageAt, messageCount } = value;
  const contact = parseContact(value.contact);
  const preview = parseBody(value.preview);
  if (
    typeof id !== 'string' ||
    !UUID_PATTERN.test(id) ||
    typeof lastMessageAt !== 'string' ||
    !ISO_DATE.test(lastMessageAt) ||
    typeof messageCount !== 'number' ||
    !Number.isSafeInteger(messageCount) ||
    messageCount < 0 ||
    contact === null ||
    preview === null
  ) {
    return null;
  }
  return { id, contact, lastMessageAt, messageCount, preview };
}

function parseMessage(value: unknown): WhatsAppInboxMessage | null {
  if (!isPlainObject(value)) return null;
  const { id, occurredAt } = value;
  const body = parseBody(value.body);
  if (typeof id !== 'string' || !UUID_PATTERN.test(id) || typeof occurredAt !== 'string' || !ISO_DATE.test(occurredAt) || body === null) {
    return null;
  }
  return { id, occurredAt, body };
}

function parseCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && CURSOR_PATTERN.test(value) ? value : undefined;
}

function parseAll<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const raw of value) {
    const item = parse(raw);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

async function requestPage<T>(
  url: string,
  accessToken: string,
  parse: (body: Record<string, unknown>) => T | null,
  signal?: AbortSignal,
): Promise<WhatsAppInboxResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal,
    });
  } catch {
    return { outcome: 'error' };
  }

  const body = await readJsonSafely(response);
  if (!isPlainObject(body)) return { outcome: 'error' };

  if (body.ok === false) {
    if (typeof body.error !== 'string' || !SNAKE_CODE.test(body.error)) return { outcome: 'error' };
    return { outcome: 'domain_error', code: body.error };
  }

  if (!response.ok) return { outcome: 'error' };
  const page = parse(body);
  return page ? { outcome: 'ok', page } : { outcome: 'error' };
}

function query(companyId: string, cursor: string | null): string {
  const params = new URLSearchParams({ company_id: companyId });
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

export function fetchWhatsAppInboxConversations(
  input: { companyId: string; cursor: string | null; accessToken: string },
  signal?: AbortSignal,
): Promise<WhatsAppInboxResult<WhatsAppInboxConversationsPage>> {
  return requestPage(
    `/api/integrations/whatsapp/inbox/conversations?${query(input.companyId, input.cursor)}`,
    input.accessToken,
    (body) => {
      const conversations = parseAll(body.conversations, parseConversation);
      const nextCursor = parseCursor(body.nextCursor);
      return conversations && nextCursor !== undefined ? { conversations, nextCursor } : null;
    },
    signal,
  );
}

export function fetchWhatsAppInboxMessages(
  input: { companyId: string; conversationId: string; cursor: string | null; accessToken: string },
  signal?: AbortSignal,
): Promise<WhatsAppInboxResult<WhatsAppInboxMessagesPage>> {
  const conversation = encodeURIComponent(input.conversationId);
  return requestPage(
    `/api/integrations/whatsapp/inbox/conversations/${conversation}/messages?${query(input.companyId, input.cursor)}`,
    input.accessToken,
    (body) => {
      const messages = parseAll(body.messages, parseMessage);
      const nextCursor = parseCursor(body.nextCursor);
      return messages && nextCursor !== undefined ? { messages, nextCursor } : null;
    },
    signal,
  );
}
