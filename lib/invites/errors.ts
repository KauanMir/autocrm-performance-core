// lib/invites/errors.ts — erro tipado da listagem administrativa de
// convites (M1-F S4-F1). Mesmo padrão de lib/companies/errors.ts: código/
// mensagem ESTÁVEIS, nunca exibidos crus ao usuário (SQLSTATE/nome de
// policy/stack ficam só em `detail`, já higienizado — nunca token/hash).

export type AdminInviteErrorCode = 'admin_invites_fetch_failed';

// Causa técnica segura: somente código (SQLSTATE) e mensagem do PostgREST —
// nunca token, hash, credencial, URL ou query completa.
export interface AdminInviteErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class AdminInviteError extends Error {
  readonly code: AdminInviteErrorCode;
  readonly detail: AdminInviteErrorDetail;

  constructor(code: AdminInviteErrorCode, detail: AdminInviteErrorDetail = {}) {
    super(code);
    this.name = 'AdminInviteError';
    this.code = code;
    this.detail = detail;
  }
}

export function isAdminInviteError(error: unknown): error is AdminInviteError {
  return error instanceof AdminInviteError;
}
