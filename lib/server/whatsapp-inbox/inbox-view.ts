// lib/server/whatsapp-inbox/inbox-view.ts — W2B-8: decifra no servidor e monta o DTO
// fechado que vai ao navegador. SERVER-ONLY, sem I/O.
//
// O DTO é escrito campo a campo. Ficam de fora ciphertext, HMAC, hashes, wamid, BSUID,
// IDs de mídia, connection_id e o telefone completo. A AAD do envelope amarra cada
// ciphertext à empresa e à mensagem: envelope movido não decifra.
//
// Falha ao decifrar uma linha não derruba a página: a linha vira `unreadable`, sem
// detalhe, e só a contagem vai para o log.
import {
  decryptWhatsAppContactPii,
  decryptWhatsAppMessageContent,
  WHATSAPP_CAPTURE_KEY_VERSION,
} from '@/lib/server/whatsapp-connection/capture-crypto';
import type { WhatsAppInboxConversationRow, WhatsAppInboxMessageRow } from './inbox-rpc';

export const WHATSAPP_INBOX_PREVIEW_LENGTH = 140;

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const MESSAGE_TYPES: readonly string[] = [
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive',
  'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported', 'other',
];

export type WhatsAppInboxBody =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'media'; mediaType: MediaType; caption: string | null; fileName: string | null }
  | { kind: 'unsupported'; messageType: string }
  | { kind: 'unreadable' };

export interface WhatsAppInboxContactView {
  displayName: string | null;
  phoneMasked: string | null;
  readable: boolean;
}

export interface WhatsAppInboxConversationView {
  id: string;
  contact: WhatsAppInboxContactView;
  lastMessageAt: string;
  messageCount: number;
  preview: WhatsAppInboxBody;
}

export interface WhatsAppInboxMessageView {
  id: string;
  occurredAt: string;
  body: WhatsAppInboxBody;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// Controle e marcas de direção do texto permitiriam forjar a aparência de um nome.
function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

// Mantém país e fim do número: identifica o contato na lista sem expor o telefone.
export function maskWhatsAppPhone(phone: unknown): string | null {
  if (typeof phone !== 'string' || !/^[0-9]{7,20}$/.test(phone)) return null;
  return `+${phone.slice(0, 2)} ••••• ${phone.slice(-4)}`;
}

function toContactView(row: WhatsAppInboxConversationRow, companyId: string, key: Buffer): WhatsAppInboxContactView {
  if (row.piiKeyVersion !== WHATSAPP_CAPTURE_KEY_VERSION) return { displayName: null, phoneMasked: null, readable: false };
  try {
    const contact: unknown = decryptWhatsAppContactPii({ companyId, piiRef: row.piiRef, ciphertext: row.piiCiphertext, key });
    if (!isRecord(contact)) return { displayName: null, phoneMasked: null, readable: false };
    return { displayName: cleanDisplayName(contact.displayName), phoneMasked: maskWhatsAppPhone(contact.phone), readable: true };
  } catch {
    return { displayName: null, phoneMasked: null, readable: false };
  }
}

function unsupportedBody(messageType: string): WhatsAppInboxBody {
  return { kind: 'unsupported', messageType: MESSAGE_TYPES.includes(messageType) ? messageType : 'other' };
}

function toBody(input: {
  companyId: string;
  connectionId: string;
  messageIdHash: string;
  messageType: string;
  ciphertext: string;
  keyVersion: number;
  key: Buffer;
}): WhatsAppInboxBody {
  if (input.keyVersion !== WHATSAPP_CAPTURE_KEY_VERSION) return { kind: 'unreadable' };
  let payload: unknown;
  try {
    payload = decryptWhatsAppMessageContent({
      companyId: input.companyId,
      connectionId: input.connectionId,
      messageIdHash: input.messageIdHash,
      ciphertext: input.ciphertext,
      key: input.key,
    });
  } catch {
    return { kind: 'unreadable' };
  }

  const content = isRecord(payload) ? payload.content : null;
  if (!isRecord(content)) return { kind: 'unreadable' };

  if (content.kind === 'text') {
    return typeof content.text === 'string'
      ? { kind: 'text', text: content.text, truncated: content.truncated === true }
      : { kind: 'unreadable' };
  }

  if (content.kind === 'media') {
    const mediaType = MEDIA_TYPES.find((candidate) => candidate === content.mediaType);
    if (!mediaType) return { kind: 'unreadable' };
    return { kind: 'media', mediaType, caption: optionalText(content.caption), fileName: optionalText(content.fileName) };
  }

  return content.kind === 'unsupported' ? unsupportedBody(input.messageType) : { kind: 'unreadable' };
}

function shorten(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const points = Array.from(flat);
  return points.length > WHATSAPP_INBOX_PREVIEW_LENGTH ? `${points.slice(0, WHATSAPP_INBOX_PREVIEW_LENGTH).join('')}…` : flat;
}

function toPreview(body: WhatsAppInboxBody): WhatsAppInboxBody {
  if (body.kind === 'text') return { ...body, text: shorten(body.text) };
  if (body.kind === 'media') return { ...body, caption: body.caption ? shorten(body.caption) : null };
  return body;
}

export function toConversationView(
  row: WhatsAppInboxConversationRow,
  companyId: string,
  key: Buffer,
): WhatsAppInboxConversationView {
  return {
    id: row.conversationId,
    contact: toContactView(row, companyId, key),
    lastMessageAt: new Date(row.lastMessageAt).toISOString(),
    messageCount: row.messageCount,
    preview: toPreview(
      toBody({
        companyId,
        connectionId: row.lastConnectionId,
        messageIdHash: row.lastMessageIdHash,
        messageType: row.lastMessageType,
        ciphertext: row.lastContentCiphertext,
        keyVersion: row.lastContentKeyVersion,
        key,
      }),
    ),
  };
}

export function toMessageView(row: WhatsAppInboxMessageRow, companyId: string, key: Buffer): WhatsAppInboxMessageView {
  return {
    id: row.messageId,
    occurredAt: new Date(row.occurredAt).toISOString(),
    body: toBody({
      companyId,
      connectionId: row.connectionId,
      messageIdHash: row.messageIdHash,
      messageType: row.messageType,
      ciphertext: row.contentCiphertext,
      keyVersion: row.contentKeyVersion,
      key,
    }),
  };
}

// ── cursores opacos ───────────────────────────────────────────────────────
// Só posição na lista, sem conteúdo. A precisão de microssegundos do banco precisa
// sobreviver à ida e volta, por isso o valor bruto passa intacto, depois de validado.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CURSOR_LENGTH = 256;

function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, size: number): string[] | null {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parts: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(parts) && parts.length === size && parts.every((part) => typeof part === 'string')
      ? (parts as string[])
      : null;
  } catch {
    return null;
  }
}

export function encodeConversationCursor(row: WhatsAppInboxConversationRow): string {
  return encodeCursor([row.lastMessageAt, row.conversationId]);
}

export function decodeConversationCursor(cursor: string): { lastMessageAt: string; id: string } | null {
  const parts = decodeCursor(cursor, 2);
  if (!parts || !TIMESTAMP_PATTERN.test(parts[0]) || !UUID_PATTERN.test(parts[1])) return null;
  return { lastMessageAt: parts[0], id: parts[1] };
}

export function encodeMessageCursor(row: WhatsAppInboxMessageRow): string {
  return encodeCursor([row.occurredAt, row.receivedAt, row.messageId]);
}

export function decodeMessageCursor(cursor: string): { occurredAt: string; receivedAt: string; id: string } | null {
  const parts = decodeCursor(cursor, 3);
  if (!parts || !TIMESTAMP_PATTERN.test(parts[0]) || !TIMESTAMP_PATTERN.test(parts[1]) || !UUID_PATTERN.test(parts[2])) {
    return null;
  }
  return { occurredAt: parts[0], receivedAt: parts[1], id: parts[2] };
}
