// lib/server/meta-webhook/logger.ts — logging mínimo e centralizado do
// webhook da Meta (mesmo padrão de lib/server/invites/logger.ts). Só
// campos técnicos numa allowlist explícita chegam ao console.
//
// NUNCA registrar: META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, a
// assinatura (recebida ou calculada, nem parcial), access tokens,
// credenciais, o payload bruto, nome, telefone, e-mail ou qualquer
// resposta de formulário do lead.
export interface MetaWebhookLogFields {
  requestId: string;
  operation: 'verify' | 'event';
  result: string;
  // Metadados técnicos mínimos de diagnóstico — todos opcionais.
  object?: string;
  field?: string;
  pageId?: string;
  formId?: string;
  leadgenId?: string;
  createdTime?: number | string;
  changeCount?: number;
  durationMs?: number;
}

export function logMetaWebhookEvent(fields: MetaWebhookLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[meta-webhook]', JSON.stringify(fields));
}

// Para erros inesperados: objeto já redigido, nunca o erro original (que
// pode carregar stack/mensagem bruta de uma dependência).
export function logMetaWebhookError(context: string, safeDetail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[meta-webhook]', context, JSON.stringify(safeDetail));
}
