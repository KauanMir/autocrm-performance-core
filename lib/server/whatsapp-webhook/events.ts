// lib/server/whatsapp-webhook/events.ts — classificação TOLERANTE de um
// payload de webhook da WhatsApp Cloud API que JÁ passou pela validação de
// assinatura e pelo JSON.parse. Este módulo:
//   - NÃO persiste nada;
//   - NÃO chama a Graph API;
//   - NÃO devolve conteúdo de mensagem, número, nome de contato nem IDs —
//     só booleanos de presença e enums de uma allowlist fechada;
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

function allowlisted(value: unknown, allowed: Set<string>): string {
  return typeof value === 'string' && allowed.has(value) ? value : 'other';
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
      const hasPhoneNumberId = metadata !== null && hasNonEmptyString(metadata.phone_number_id);
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
        });
      }

      if (events.length === before) ignoredChangeCount += 1;
    }
  }

  return { object, isWhatsAppBusinessAccount, events, ignoredChangeCount };
}
