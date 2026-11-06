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
  formPresent?: boolean;
  leadgenPresent?: boolean;
  // META-MVP2: evento registrado para a empresa dona da Page (sem ID).
  ownerRegistered?: boolean;
  httpStatus?: number;
  changeCount?: number;
  durationMs?: number;
}

export function logMetaWebhookEvent(fields: MetaWebhookLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[meta-webhook]', JSON.stringify(fields));
}

// META-MVP1 — resultado de cada tentativa de processamento. `eventRef` é o
// UUID INTERNO da linha do ledger (não é ID da Meta nem PII) e liga o log à
// fila de revisão. Nunca nome, telefone, e-mail, respostas, IDs da Meta ou token.
export interface MetaLeadProcessingLogFields {
  operation: 'leadgen_process';
  trigger: 'webhook' | 'sweep' | 'manual_requeue';
  eventRef: string;
  outcome: string;
  errorCode?: string;
  integrationMarked?: 'token_invalid' | 'token_expired' | 'permission_missing';
  answersCount?: number;
  answersTruncated?: number;
  sensitiveOmitted?: number;
  mappedTargets?: number;
  durationMs?: number;
}

export function logMetaLeadProcessing(fields: MetaLeadProcessingLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[meta-leadgen]', JSON.stringify(fields));
}

// Para erros inesperados: objeto já redigido, nunca o erro original (que
// pode carregar stack/mensagem bruta de uma dependência).
export function logMetaWebhookError(context: string, safeDetail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[meta-webhook]', context, JSON.stringify(safeDetail));
}
