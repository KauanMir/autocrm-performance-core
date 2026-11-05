// lib/server/whatsapp-webhook/logger.ts — logging mínimo e centralizado do
// webhook da WhatsApp Cloud API (mesmo padrão de meta-webhook/logger.ts).
// Defesa em profundidade: o objeto logado é reconstruído campo a campo a
// partir de uma allowlist — chave extra passada por engano nunca sai.
//
// NUNCA registrar: META_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN, a
// assinatura (recebida ou calculada, nem parcial), access tokens, o payload
// bruto, conteúdo de mensagem, número de telefone (from/recipient_id/
// display_phone_number), nome de contato, wa_id, phone_number_id, WABA id ou
// message id.
export interface WhatsAppWebhookLogFields {
  requestId: string;
  phase: 'verify' | 'event';
  result: string;
  eventType?: 'message_received' | 'message_status' | 'ignored';
  hasPhoneNumberId?: boolean;
  hasMessageId?: boolean;
  messageType?: string;
  status?: string;
  hasErrors?: boolean;
  messageReceivedCount?: number;
  messageStatusCount?: number;
  ignoredChangeCount?: number;
  // Ingestão (W2A, só com a flag ON) — contagens, nunca IDs externos.
  registeredCount?: number;
  duplicateCount?: number;
  unknownNumberCount?: number;
  unusableCount?: number;
  // Captura (W2B-5) — contagens, nunca conteúdo.
  capturedCount?: number;
  captureDisabledCount?: number;
  wabaMismatchCount?: number;
  failedCount?: number;
  groupMessageCount?: number;
  invalidTimestampCount?: number;
  durationMs?: number;
}

const ALLOWED_KEYS: ReadonlyArray<keyof WhatsAppWebhookLogFields> = [
  'requestId',
  'phase',
  'result',
  'eventType',
  'hasPhoneNumberId',
  'hasMessageId',
  'messageType',
  'status',
  'hasErrors',
  'messageReceivedCount',
  'messageStatusCount',
  'ignoredChangeCount',
  'registeredCount',
  'duplicateCount',
  'unknownNumberCount',
  'unusableCount',
  'capturedCount',
  'captureDisabledCount',
  'wabaMismatchCount',
  'failedCount',
  'groupMessageCount',
  'invalidTimestampCount',
  'durationMs',
];

export function logWhatsAppWebhookEvent(fields: WhatsAppWebhookLogFields): void {
  const safe: Record<string, unknown> = { operation: 'whatsapp_webhook' };
  for (const key of ALLOWED_KEYS) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  // eslint-disable-next-line no-console
  console.log('[whatsapp-webhook]', JSON.stringify(safe));
}

// Para falhas de configuração: só um contexto fixo + requestId, nunca o
// erro original.
export function logWhatsAppWebhookError(context: string, requestId: string): void {
  // eslint-disable-next-line no-console
  console.error('[whatsapp-webhook]', context, JSON.stringify({ operation: 'whatsapp_webhook', requestId }));
}
