// lib/server/whatsapp-inbox/logger.ts — W2B-8. O objeto logado é reconstruído campo a
// campo: nada de conteúdo, nome, telefone, IDs de conversa ou de empresa.
export function logWhatsAppInbox(fields: {
  requestId: string;
  operation: 'conversations' | 'messages';
  result: string;
  returned?: number;
  unreadable?: number;
  durationMs: number;
}): void {
  // eslint-disable-next-line no-console
  console.log(
    '[whatsapp-inbox]',
    JSON.stringify({
      operation: `whatsapp_inbox_${fields.operation}`,
      requestId: fields.requestId,
      result: fields.result,
      returned: fields.returned ?? 0,
      unreadable: fields.unreadable ?? 0,
      durationMs: fields.durationMs,
    }),
  );
}
