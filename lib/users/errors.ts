// lib/users/errors.ts — erro tipado da listagem/edição administrativa de
// usuários ativos (M1-F S5-D). Mesmo padrão de lib/invites/errors.ts e
// lib/companies/errors.ts: código/mensagem ESTÁVEIS, nunca exibidos crus ao
// usuário (SQLSTATE/nome de policy/stack ficam só em `detail`, já
// higienizado — nunca token/hash).
//
// Usado exclusivamente para falhas de TRANSPORTE/FORMATO (RPC não respondeu,
// resposta com forma inesperada). Os códigos de domínio que
// update_profile_name/update_membership_role levantam via `raise using
// message = '...'` (unauthenticated, forbidden, profile_not_found,
// membership_not_found, user_inactive, invalid_name, invalid_role,
// self_role_change_forbidden, last_manager_requires_successor,
// seller_state_conflict) NUNCA são embrulhados aqui — chegam como o erro cru
// do PostgREST (mesmo padrão de reorder_pipeline_stages/useReorderStages),
// para que getUpdateProfileNameErrorMessage/getUpdateMembershipRoleErrorMessage
// possam inspecionar error.message diretamente.

export type CompanyUserErrorCode = 'company_users_fetch_failed' | 'company_users_invalid_response';

// Causa técnica segura: somente código (SQLSTATE) e mensagem do PostgREST —
// nunca token, hash, credencial, URL ou query completa.
export interface CompanyUserErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class CompanyUserError extends Error {
  readonly code: CompanyUserErrorCode;
  readonly detail: CompanyUserErrorDetail;

  constructor(code: CompanyUserErrorCode, detail: CompanyUserErrorDetail = {}) {
    super(code);
    this.name = 'CompanyUserError';
    this.code = code;
    this.detail = detail;
  }
}

export function isCompanyUserError(error: unknown): error is CompanyUserError {
  return error instanceof CompanyUserError;
}
