// lib/inactiveUsers/errors.ts — erro tipado da leitura administrativa de
// memberships inativas (M1-F S6-E). Mesmo padrão de lib/users/errors.ts:
// código/mensagem ESTÁVEIS, nunca exibidos crus ao usuário (SQLSTATE/nome de
// policy/stack ficam só em `detail`, já higienizado — nunca token/hash).
//
// Usado exclusivamente para falhas de TRANSPORTE/FORMATO (RPC não respondeu,
// resposta com forma inesperada). Os códigos de domínio que
// list_inactive_company_users levanta via `raise using message = '...'`
// (unauthenticated, forbidden, invalid_limit, invalid_cursor, invalid_search,
// invalid_lifecycle) NUNCA são embrulhados aqui — chegam como o erro cru do
// PostgREST, mesmo padrão de fetchCompanyUsers.

export type InactiveCompanyUserErrorCode =
  | 'inactive_company_users_fetch_failed'
  | 'inactive_company_users_invalid_response';

// Causa técnica segura: somente código (SQLSTATE) e mensagem do PostgREST —
// nunca token, hash, credencial, URL ou query completa.
export interface InactiveCompanyUserErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class InactiveCompanyUserError extends Error {
  readonly code: InactiveCompanyUserErrorCode;
  readonly detail: InactiveCompanyUserErrorDetail;

  constructor(code: InactiveCompanyUserErrorCode, detail: InactiveCompanyUserErrorDetail = {}) {
    super(code);
    this.name = 'InactiveCompanyUserError';
    this.code = code;
    this.detail = detail;
  }
}

export function isInactiveCompanyUserError(error: unknown): error is InactiveCompanyUserError {
  return error instanceof InactiveCompanyUserError;
}
