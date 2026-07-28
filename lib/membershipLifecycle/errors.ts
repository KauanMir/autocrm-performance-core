// lib/membershipLifecycle/errors.ts — erro tipado das cinco RPCs de ciclo de
// vida empresarial (M1-F S6-F): suspend_membership/reactivate_membership
// (S6-B), offboard_seller/offboard_manager (S6-C/S6-E2), transfer_membership
// (S6-D). Mesmo padrão de lib/users/errors.ts e lib/inactiveUsers/errors.ts:
// código/mensagem ESTÁVEIS, nunca exibidos crus ao usuário.
//
// Usado exclusivamente para falhas de TRANSPORTE/FORMATO (RPC não respondeu,
// resposta com forma inesperada). Os códigos de domínio que cada RPC levanta
// via `raise using message = '...'` NUNCA são embrulhados aqui — chegam como
// o erro cru do PostgREST, mesmo padrão de updateMembershipRoleRpc. Cada hook
// (useSuspendMembership etc.) tem sua própria função getXErrorMessage que
// inspeciona error.message diretamente.

export type MembershipLifecycleErrorCode =
  | 'membership_lifecycle_fetch_failed'
  | 'membership_lifecycle_invalid_response';

export interface MembershipLifecycleErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class MembershipLifecycleError extends Error {
  readonly code: MembershipLifecycleErrorCode;
  readonly detail: MembershipLifecycleErrorDetail;

  constructor(code: MembershipLifecycleErrorCode, detail: MembershipLifecycleErrorDetail = {}) {
    super(code);
    this.name = 'MembershipLifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

export function isMembershipLifecycleError(error: unknown): error is MembershipLifecycleError {
  return error instanceof MembershipLifecycleError;
}
