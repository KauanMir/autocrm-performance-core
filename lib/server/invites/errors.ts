// lib/server/invites/errors.ts — catálogo fechado de códigos de erro HTTP
// do módulo de convites (M1-F S4-A2B, design §16/§17). Nenhum texto interno,
// SQLSTATE, stack ou mensagem bruta da Admin API do Supabase Auth chega ao
// chamador — só um destes códigos estáveis.
export type InviteErrorCode =
  | 'invalid_body'
  | 'invalid_input'
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_origin'
  | 'duplicate_pending'
  | 'already_member'
  | 'not_eligible'
  | 'token_conflict'
  | 'invalid_role'
  | 'invalid_company'
  | 'company_not_operational'
  | 'rate_limited'
  | 'delivery_failed'
  | 'auth_unavailable'
  | 'internal_error'
  | 'delivery_finalize_failed'
  | 'invite_not_found'
  | 'invite_not_actionable'
  | 'body_too_large';

const STATUS_BY_CODE: Record<InviteErrorCode, number> = {
  invalid_body: 400,
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  invalid_origin: 403,
  duplicate_pending: 409,
  already_member: 409,
  not_eligible: 409,
  token_conflict: 409,
  invalid_role: 422,
  invalid_company: 422,
  company_not_operational: 422,
  rate_limited: 429,
  delivery_failed: 502,
  auth_unavailable: 503,
  internal_error: 500,
  delivery_finalize_failed: 503,
  invite_not_found: 404,
  invite_not_actionable: 409,
  body_too_large: 413,
};

// Subconjunto de InviteErrorCode que corresponde 1:1 a um `code` de falha
// de domínio devolvido por create_invite()/resend_invite() (nunca inclui
// códigos puramente HTTP como invalid_body/unauthenticated/rate_limited,
// que não têm origem na RPC).
const KNOWN_DOMAIN_CODES: ReadonlySet<string> = new Set<InviteErrorCode>([
  'invalid_input',
  'invalid_role',
  'invalid_company',
  'company_not_operational',
  'already_member',
  'not_eligible',
  'duplicate_pending',
  'token_conflict',
  'invite_not_found',
  'invite_not_actionable',
]);

export function statusForCode(code: InviteErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function isKnownDomainCode(code: string): code is InviteErrorCode {
  return KNOWN_DOMAIN_CODES.has(code);
}
