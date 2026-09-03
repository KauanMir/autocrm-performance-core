// lib/server/meta-oauth/logger.ts — logging mínimo e centralizado do
// fluxo OAuth Meta (mesmo padrão de lib/server/invites/logger.ts e
// lib/server/meta-webhook/logger.ts). Só campos numa allowlist explícita
// chegam ao console.
//
// NUNCA registrar: o header Authorization / JWT, o `code` OAuth (nem
// parcial), access token, refresh token, App Secret, verify token, o
// `state` completo, o binding (bruto ou hash), cookies, sessão,
// `error_description` bruto da Meta ou qualquer PII.
export interface MetaOAuthLogFields {
  requestId: string;
  operation: 'oauth_callback' | 'oauth_start';
  result: string;
  // Metadados técnicos mínimos — todos opcionais.
  reason?: string; // motivo sanitizado de rejeição (enum interno)
  providerErrorCode?: string; // valor de `error` da Meta, já sanitizado
  codePresent?: boolean;
  codeLength?: number; // só o comprimento, nunca o valor
  statePresent?: boolean;
  bindingCookiePresent?: boolean;
  // /start — resultado de autenticação/autorização, sem dados sensíveis.
  authenticatedUserPresent?: boolean;
  companyResolved?: boolean;
  permissionGranted?: boolean;
  bindingSet?: boolean;
  durationMs?: number;
}

export function logMetaOAuthEvent(fields: MetaOAuthLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[meta-oauth]', JSON.stringify(fields));
}

// Erros inesperados: objeto já redigido, nunca o erro original (que pode
// carregar stack/mensagem bruta de dependência).
export function logMetaOAuthError(context: string, safeDetail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[meta-oauth]', context, JSON.stringify(safeDetail));
}
