// lib/server/whatsapp-webhook/events.ts — classificação TOLERANTE de um
// payload de webhook da WhatsApp Cloud API que JÁ passou pela validação de
// assinatura e pelo JSON.parse. Este módulo:
//   - NÃO persiste nada;
//   - NÃO chama a Graph API;
//   - NÃO devolve conteúdo de mensagem, telefone/nome do contato, texto nem
//     mídia — só booleanos de presença e enums de uma allowlist fechada;
//   - devolve phone_number_id / wamid / timestamp / status bruto APENAS nos
//     campos internos de ingestão (W2A), que o logger nunca aceita
//     (allowlist de campos);
//   - nunca lança: qualquer forma inesperada vira "ignorado".
//
// Estrutura oficial (object = "whatsapp_business_account"):
//   entry[].changes[] { field: "messages", value: {
//     metadata: { phone_number_id, display_phone_number },
//     contacts[], messages[], statuses[], errors[] } }
// Pode haver vários entries, várias changes e vários itens por change.

export const WHATSAPP_OBJECT = 'whatsapp_business_account';

export type WhatsAppEventType = 'message_received' | 'message_status';

// Allowlists fechadas: um valor fora da lista vira 'other'. Assim nenhuma
// string arbitrária do payload chega ao log.
const MESSAGE_TYPES = new Set([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
  'reaction',
  'order',
  'system',
  'request_welcome',
  'unsupported',
]);

const STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed', 'deleted', 'warning']);

export interface WhatsAppWebhookEvent {
  eventType: WhatsAppEventType;
  hasPhoneNumberId: boolean;
  hasMessageId: boolean;
  // Só em message_received.
  messageType?: string;
  // Só em message_status.
  status?: string;
  hasErrors?: boolean;
  // Internos — só para a ingestão no ledger (W2A). NUNCA logar.
  phoneNumberId?: string;
  messageId?: string;
  occurredAt?: Date;
  // Valor BRUTO de statuses[].status (só em message_status): entra apenas
  // no hash da event_key; nunca persistido, logado ou devolvido.
  rawStatus?: unknown;
}

export interface ParsedWhatsAppWebhook {
  object: string | null;
  isWhatsAppBusinessAccount: boolean;
  events: WhatsAppWebhookEvent[];
  // Changes sem messages[]/statuses[] reconhecíveis (outro field, value
  // vazio, só errors[] etc.) — contadas, nunca inspecionadas.
  ignoredChangeCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

function nonEmptyString(value: unknown): string | undefined {
  return hasNonEmptyString(value) ? (value as string) : undefined;
}

// timestamp da Cloud API: segundos Unix em string.
export function unixSecondsToDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^[0-9]{1,12}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 ? new Date(seconds * 1000) : undefined;
}

function allowlisted(value: unknown, allowed: Set<string>): string {
  return typeof value === 'string' && allowed.has(value) ? value : 'other';
}

export function classifyWhatsAppMessageType(value: unknown): string {
  return allowlisted(value, MESSAGE_TYPES);
}

export function classifyWhatsAppStatus(value: unknown): string {
  return allowlisted(value, STATUS_VALUES);
}

// `payload` é o resultado de JSON.parse(rawBody) — `unknown` de propósito.
export function parseWhatsAppWebhookPayload(payload: unknown): ParsedWhatsAppWebhook {
  const root = asRecord(payload);
  const object = root && typeof root.object === 'string' && root.object !== '' ? root.object : null;
  const isWhatsAppBusinessAccount = object === WHATSAPP_OBJECT;

  const events: WhatsAppWebhookEvent[] = [];
  let ignoredChangeCount = 0;

  if (!isWhatsAppBusinessAccount) {
    return { object, isWhatsAppBusinessAccount, events, ignoredChangeCount };
  }

  const entries = root && Array.isArray(root.entry) ? root.entry : [];
  for (const entryRaw of entries) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = asRecord(changeRaw);
      const value = change ? asRecord(change.value) : null;
      if (!change || change.field !== 'messages' || !value) {
        ignoredChangeCount += 1;
        continue;
      }

      const metadata = asRecord(value.metadata);
      const phoneNumberId = metadata !== null ? nonEmptyString(metadata.phone_number_id) : undefined;
      const hasPhoneNumberId = phoneNumberId !== undefined;
      const before = events.length;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const messageRaw of messages) {
        const message = asRecord(messageRaw);
        if (!message) continue;
        events.push({
          eventType: 'message_received',
          hasPhoneNumberId,
          hasMessageId: hasNonEmptyString(message.id),
          messageType: allowlisted(message.type, MESSAGE_TYPES),
          phoneNumberId,
          messageId: nonEmptyString(message.id),
          occurredAt: unixSecondsToDate(message.timestamp),
        });
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const statusRaw of statuses) {
        const status = asRecord(statusRaw);
        if (!status) continue;
        events.push({
          eventType: 'message_status',
          hasPhoneNumberId,
          hasMessageId: hasNonEmptyString(status.id),
          status: allowlisted(status.status, STATUS_VALUES),
          hasErrors: Array.isArray(status.errors) && status.errors.length > 0,
          phoneNumberId,
          messageId: nonEmptyString(status.id),
          occurredAt: unixSecondsToDate(status.timestamp),
          rawStatus: status.status,
        });
      }

      if (events.length === before) ignoredChangeCount += 1;
    }
  }

  return { object, isWhatsAppBusinessAccount, events, ignoredChangeCount };
}
