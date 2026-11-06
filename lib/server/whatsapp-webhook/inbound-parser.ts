// lib/server/whatsapp-webhook/inbound-parser.ts — W2B-3: normaliza a entrega do
// webhook WhatsApp para a captura transacional. SERVER-ONLY e sem I/O: nada de
// banco, Graph, env ou log. Roda só depois da assinatura e do JSON.parse.
//
// O resultado contém dados pessoais (telefone, nome, texto, wamid) e existe
// apenas em memória: quem consome cifra antes de persistir e nunca passa estes
// objetos ao logger. O payload bruto nunca é devolvido.
//
// Valores fora do contrato não derrubam a entrega: cada item vira mensagem
// normalizada, mensagem com conteúdo não suportado ou rejeição contada. O parser
// não assume ordem entre eventos: cada item carrega o próprio occurredAt.
//
// Mensagem de grupo traz group_id, sem formato documentado: a detecção é pela
// presença do campo. Grupo nunca vira contato nem conversa individual.
//
// Horário fora da faixa aceita vira null: quem consome usa o recebimento. Assim um
// timestamp absurdo não muda a ordem da conversa nem provoca reentrega.
//
// Contrato da Meta para identificação do contato:
//   messages[].from / contacts[].wa_id: telefone. Pode faltar quando o usuário
//     tem username e não há contato recente.
//   messages[].from_user_id / contacts[].user_id: BSUID, por portfólio.
import {
  classifyWhatsAppMessageType,
  classifyWhatsAppStatus,
  unixSecondsToDate,
  WHATSAPP_OBJECT,
} from './events';

export const MAX_INBOUND_TEXT_LENGTH = 8192;
export const MAX_WHATSAPP_MESSAGE_ID_LENGTH = 512;

// Limite inferior: ano de criação do WhatsApp. Superior: tolerância de relógio.
// A RPC de captura aplica a mesma faixa.
export const MIN_OCCURRED_AT_MS = Date.UTC(2009, 0, 1);
export const MAX_OCCURRED_AT_SKEW_MS = 24 * 60 * 60 * 1000;

const MAX_NAME_LENGTH = 256;
const MAX_FILE_NAME_LENGTH = 256;

const NUMERIC_ID_PATTERN = /^[0-9]{1,30}$/;
const PHONE_PATTERN = /^[1-9][0-9]{6,19}$/;
const BSUID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/;
const PARENT_BSUID_PATTERN = /^[A-Z]{2}\.ENT\.[A-Za-z0-9]{1,128}$/;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const MIME_TYPE_PATTERN = /^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64}(; ?[a-z0-9=._+-]{1,64})*$/i;
const SHA256_PATTERN = /^[A-Za-z0-9+/_=-]{1,128}$/;

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
export type InboundMediaType = (typeof MEDIA_TYPES)[number];

export interface InboundContact {
  // Telefone só com dígitos, quando a Meta enviou.
  phone: string | null;
  bsuid: string | null;
  parentBsuid: string | null;
  displayName: string | null;
}

export type InboundContent =
  | { kind: 'text'; text: string; truncated: boolean }
  | {
      kind: 'media';
      mediaType: InboundMediaType;
      mediaId: string | null;
      mimeType: string | null;
      sha256: string | null;
      caption: string | null;
      fileName: string | null;
    }
  | { kind: 'unsupported' };

export interface ParsedInboundMessage {
  wabaId: string | null;
  phoneNumberId: string;
  wamid: string;
  // Allowlist de events.ts; valor desconhecido vira 'other'.
  messageType: string;
  occurredAt: Date | null;
  contact: InboundContact;
  content: InboundContent;
  repliedToWamid: string | null;
}

export interface ParsedInboundStatus {
  wabaId: string | null;
  phoneNumberId: string;
  wamid: string;
  statusValue: string;
  // Valor bruto: serve só para o hash da event_key.
  rawStatus: unknown;
  occurredAt: Date | null;
}

export type InboundRejectionReason =
  | 'malformed_item'
  | 'missing_phone_number_id'
  | 'missing_message_id'
  | 'missing_contact'
  | 'group_message';

export interface RejectedInboundMessage {
  wabaId: string | null;
  phoneNumberId: string;
  wamid: string;
  messageType: string;
  occurredAt: Date | null;
}

export interface RejectedInboundItem {
  reason: InboundRejectionReason;
  // Preenchido quando a mensagem permite rastreio no ledger, sem dado pessoal.
  message: RejectedInboundMessage | null;
}

export interface ParsedInboundDelivery {
  isWhatsAppBusinessAccount: boolean;
  messages: ParsedInboundMessage[];
  statuses: ParsedInboundStatus[];
  rejected: RejectedInboundItem[];
  // Itens repetidos dentro da mesma entrega, descartados aqui.
  duplicateCount: number;
  invalidTimestampCount: number;
}

interface ItemScope {
  wabaId: string | null;
  phoneNumberId: string | null;
  parseTimestamp: (value: unknown) => Date | null;
}

interface ContactBlock {
  phone: string | null;
  bsuid: string | null;
  parentBsuid: string | null;
  displayName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function trimmedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, maxLength);
}

function parseContactBlocks(value: unknown): ContactBlock[] {
  const blocks: ContactBlock[] = [];
  for (const raw of asArray(value)) {
    const contact = asRecord(raw);
    if (!contact) continue;
    const profile = asRecord(contact.profile);
    blocks.push({
      phone: matching(contact.wa_id, PHONE_PATTERN),
      // `wa_id` pode trazer o BSUID quando o usuário tem username.
      bsuid: matching(contact.user_id, BSUID_PATTERN) ?? matching(contact.wa_id, BSUID_PATTERN),
      parentBsuid: matching(contact.parent_user_id, PARENT_BSUID_PATTERN),
      displayName: profile ? trimmedText(profile.name, MAX_NAME_LENGTH) : null,
    });
  }
  return blocks;
}

function findContactBlock(blocks: ContactBlock[], phone: string | null, bsuid: string | null): ContactBlock | null {
  const matched = blocks.find(
    (block) => (bsuid !== null && block.bsuid === bsuid) || (phone !== null && block.phone === phone),
  );
  if (matched) return matched;
  // Sem identificador na mensagem, só um bloco único é inequívoco.
  return phone === null && bsuid === null && blocks.length === 1 ? blocks[0] : null;
}

function resolveContact(message: Record<string, unknown>, blocks: ContactBlock[]): InboundContact | null {
  const fromPhone = matching(message.from, PHONE_PATTERN);
  const fromBsuid = matching(message.from_user_id, BSUID_PATTERN) ?? matching(message.from, BSUID_PATTERN);
  const block = findContactBlock(blocks, fromPhone, fromBsuid);

  const phone = fromPhone ?? block?.phone ?? null;
  const bsuid = fromBsuid ?? block?.bsuid ?? null;
  if (phone === null && bsuid === null) return null;

  return {
    phone,
    bsuid,
    parentBsuid: matching(message.from_parent_user_id, PARENT_BSUID_PATTERN) ?? block?.parentBsuid ?? null,
    displayName: block?.displayName ?? null,
  };
}

function parseContent(message: Record<string, unknown>, messageType: string): InboundContent {
  if (messageType === 'text') {
    const text = asRecord(message.text);
    const body = text && typeof text.body === 'string' ? text.body : '';
    if (body.trim() === '') return { kind: 'unsupported' };
    return {
      kind: 'text',
      text: body.slice(0, MAX_INBOUND_TEXT_LENGTH),
      truncated: body.length > MAX_INBOUND_TEXT_LENGTH,
    };
  }

  const mediaType = MEDIA_TYPES.find((candidate) => candidate === messageType);
  if (mediaType) {
    const media = asRecord(message[mediaType]);
    return {
      kind: 'media',
      mediaType,
      mediaId: media ? matching(media.id, MEDIA_ID_PATTERN) : null,
      mimeType: media ? matching(media.mime_type, MIME_TYPE_PATTERN) : null,
      sha256: media ? matching(media.sha256, SHA256_PATTERN) : null,
      caption: media ? trimmedText(media.caption, MAX_INBOUND_TEXT_LENGTH) : null,
      fileName: media ? trimmedText(media.filename, MAX_FILE_NAME_LENGTH) : null,
    };
  }

  return { kind: 'unsupported' };
}

function parseMessageId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= MAX_WHATSAPP_MESSAGE_ID_LENGTH ? value : null;
}

function parseMessageItem(
  raw: unknown,
  scope: ItemScope & { contacts: ContactBlock[] },
): ParsedInboundMessage | RejectedInboundItem {
  const message = asRecord(raw);
  if (!message) return { reason: 'malformed_item', message: null };
  if (scope.phoneNumberId === null) return { reason: 'missing_phone_number_id', message: null };

  const wamid = parseMessageId(message.id);
  if (wamid === null) return { reason: 'missing_message_id', message: null };

  const messageType = classifyWhatsAppMessageType(message.type);
  const occurredAt = scope.parseTimestamp(message.timestamp);
  const rejected = { wabaId: scope.wabaId, phoneNumberId: scope.phoneNumberId, wamid, messageType, occurredAt };

  if (message.group_id !== undefined && message.group_id !== null) {
    return { reason: 'group_message', message: rejected };
  }

  const contact = resolveContact(message, scope.contacts);
  if (contact === null) return { reason: 'missing_contact', message: rejected };

  const context = asRecord(message.context);
  return {
    wabaId: scope.wabaId,
    phoneNumberId: scope.phoneNumberId,
    wamid,
    messageType,
    occurredAt,
    contact,
    content: parseContent(message, messageType),
    repliedToWamid: context ? parseMessageId(context.id) : null,
  };
}

function parseStatusItem(raw: unknown, scope: ItemScope): ParsedInboundStatus | RejectedInboundItem {
  const status = asRecord(raw);
  if (!status) return { reason: 'malformed_item', message: null };
  if (status.recipient_type === 'group') return { reason: 'group_message', message: null };
  if (scope.phoneNumberId === null) return { reason: 'missing_phone_number_id', message: null };

  const wamid = parseMessageId(status.id);
  if (wamid === null) return { reason: 'missing_message_id', message: null };

  return {
    wabaId: scope.wabaId,
    phoneNumberId: scope.phoneNumberId,
    wamid,
    statusValue: classifyWhatsAppStatus(status.status),
    rawStatus: status.status,
    occurredAt: scope.parseTimestamp(status.timestamp),
  };
}

function isRejected(value: object): value is RejectedInboundItem {
  return 'reason' in value;
}

function statusDedupeKey(status: ParsedInboundStatus): string {
  return JSON.stringify([status.phoneNumberId, status.wamid, status.rawStatus ?? null]);
}

// `payload` é o resultado de JSON.parse(rawBody): `unknown` de propósito.
// `now` é o instante do recebimento, referência da tolerância de relógio.
export function parseWhatsAppInboundDelivery(
  payload: unknown,
  options: { now?: Date } = {},
): ParsedInboundDelivery {
  const delivery: ParsedInboundDelivery = {
    isWhatsAppBusinessAccount: false,
    messages: [],
    statuses: [],
    rejected: [],
    duplicateCount: 0,
    invalidTimestampCount: 0,
  };

  const maxOccurredAtMs = (options.now ?? new Date()).getTime() + MAX_OCCURRED_AT_SKEW_MS;
  const parseTimestamp = (value: unknown): Date | null => {
    if (value === undefined || value === null) return null;
    const date = unixSecondsToDate(value);
    if (date === undefined || date.getTime() < MIN_OCCURRED_AT_MS || date.getTime() > maxOccurredAtMs) {
      delivery.invalidTimestampCount += 1;
      return null;
    }
    return date;
  };

  const root = asRecord(payload);
  if (!root || root.object !== WHATSAPP_OBJECT) return delivery;
  delivery.isWhatsAppBusinessAccount = true;

  const seen = new Set<string>();
  const firstSeen = (key: string): boolean => {
    if (seen.has(key)) {
      delivery.duplicateCount += 1;
      return false;
    }
    seen.add(key);
    return true;
  };

  for (const entryRaw of asArray(root.entry)) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;
    const wabaId = matching(entry.id, NUMERIC_ID_PATTERN);

    for (const changeRaw of asArray(entry.changes)) {
      const change = asRecord(changeRaw);
      const value = change ? asRecord(change.value) : null;
      if (!change || change.field !== 'messages' || !value) continue;

      const metadata = asRecord(value.metadata);
      const phoneNumberId = metadata ? matching(metadata.phone_number_id, NUMERIC_ID_PATTERN) : null;
      const contacts = parseContactBlocks(value.contacts);

      for (const raw of asArray(value.messages)) {
        const parsed = parseMessageItem(raw, { wabaId, phoneNumberId, contacts, parseTimestamp });
        if (isRejected(parsed)) delivery.rejected.push(parsed);
        else if (firstSeen(JSON.stringify(['message', parsed.phoneNumberId, parsed.wamid]))) delivery.messages.push(parsed);
      }

      for (const raw of asArray(value.statuses)) {
        const parsed = parseStatusItem(raw, { wabaId, phoneNumberId, parseTimestamp });
        if (isRejected(parsed)) delivery.rejected.push(parsed);
        else if (firstSeen(`status:${statusDedupeKey(parsed)}`)) delivery.statuses.push(parsed);
      }
    }
  }

  return delivery;
}
