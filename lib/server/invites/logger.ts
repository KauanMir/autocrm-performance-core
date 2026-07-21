// lib/server/invites/logger.ts — logging mínimo e centralizado do módulo
// de convites (M1-F S4-A2B, design §19). Só campos explicitamente
// autorizados chegam ao console — nunca Authorization/JWT/service key/
// rawToken/tokenHash/redirectTo/link/e-mail/body/metadata/resposta bruta
// do Supabase/stack.
export interface InviteLogFields {
  requestId: string;
  operation: 'create' | 'resend' | 'validate' | 'accept';
  result: string;
  actorProfileId?: string;
  companyId?: string | null;
  inviteId?: string;
  durationMs?: number;
  code?: string;
}

export function logInviteEvent(fields: InviteLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[invites]', JSON.stringify(fields));
}

// Para erros inesperados: objeto já redigido, nunca o erro original (que
// pode conter stack/mensagem bruta de uma dependência).
export function logInviteError(context: string, safeDetail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[invites]', context, JSON.stringify(safeDetail));
}
