// lib/server/users/errors.ts — catálogo fechado de códigos de erro HTTP do
// fluxo administrativo de alteração de e-mail (M1-F S5-E1-A, decisões
// congeladas do S5-E0). Nenhum texto interno, SQLSTATE, stack ou mensagem
// bruta do Supabase Auth/Postgres chega ao chamador — só um destes códigos
// estáveis. Mesmo padrão de lib/server/invites/errors.ts.
export type UserEmailErrorCode =
  | 'invalid_body'
  | 'invalid_email'
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_origin'
  | 'user_not_found'
  | 'user_inactive'
  | 'email_already_in_use'
  | 'user_email_state_conflict'
  | 'email_update_failed'
  | 'email_compensation_failed'
  | 'internal_error'
  | 'body_too_large';

const STATUS_BY_CODE: Record<UserEmailErrorCode, number> = {
  invalid_body: 400,
  invalid_email: 400,
  unauthenticated: 401,
  forbidden: 403,
  invalid_origin: 403,
  user_not_found: 404,
  user_inactive: 409,
  email_already_in_use: 409,
  user_email_state_conflict: 409,
  email_update_failed: 500,
  email_compensation_failed: 503,
  internal_error: 500,
  body_too_large: 413,
};

export function statusForCode(code: UserEmailErrorCode): number {
  return STATUS_BY_CODE[code];
}
