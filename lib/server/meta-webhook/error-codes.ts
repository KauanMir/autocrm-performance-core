// Códigos internos fechados do processamento de eventos leadgen da Meta.
// SERVER-ONLY. Só classificação pura: não há retry engine aqui. Nunca guardar
// mensagem bruta da Meta ou de dependência em last_error_code.

export const META_LEAD_ERROR_CODES = [
  'token_decrypt_failed',
  'token_invalid',
  'graph_permission_missing',
  'graph_timeout',
  'graph_error',
  'graph_malformed',
  'lead_not_found',
  'crm_create_failed',
  'initial_stage_missing',
  'integration_not_found',
  'invalid_field_data',
  'missing_name',
  'missing_phone',
  'duplicate_phone_ambiguous',
  'max_attempts',
  'event_expired',
] as const;

export type MetaLeadErrorCode = (typeof META_LEAD_ERROR_CODES)[number];

// retryable: falha transitória, nova tentativa automática.
// operational: nova tentativa continua possível, mas exige ação de operador
//   (reconectar, chave, permissão, configuração de etapa).
// terminal: não há nova tentativa que mude o resultado.
export type MetaLeadErrorKind = 'retryable' | 'operational' | 'terminal';

const ERROR_KIND: Record<MetaLeadErrorCode, MetaLeadErrorKind> = {
  graph_timeout: 'retryable',
  graph_error: 'retryable',
  graph_malformed: 'retryable',
  lead_not_found: 'retryable',
  crm_create_failed: 'retryable',
  token_decrypt_failed: 'operational',
  token_invalid: 'operational',
  graph_permission_missing: 'operational',
  initial_stage_missing: 'operational',
  integration_not_found: 'terminal',
  invalid_field_data: 'terminal',
  missing_name: 'terminal',
  missing_phone: 'terminal',
  duplicate_phone_ambiguous: 'terminal',
  max_attempts: 'terminal',
  event_expired: 'terminal',
};

export function isMetaLeadErrorCode(value: unknown): value is MetaLeadErrorCode {
  return typeof value === 'string' && (META_LEAD_ERROR_CODES as readonly string[]).includes(value);
}

export function metaLeadErrorKind(code: MetaLeadErrorCode): MetaLeadErrorKind {
  return ERROR_KIND[code];
}

export function isMetaLeadErrorRetryable(code: MetaLeadErrorCode): boolean {
  return ERROR_KIND[code] !== 'terminal';
}
