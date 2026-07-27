// lib/server/users/logger.ts — logging mínimo e centralizado do fluxo
// administrativo de alteração de e-mail (M1-F S5-E1-A, design §22.7).
// Mesmo padrão de lib/server/invites/logger.ts: só campos explicitamente
// autorizados chegam ao console. NUNCA o e-mail (antigo ou novo), NUNCA
// Authorization/JWT/service key, NUNCA resposta bruta do Supabase Auth.
export interface UserEmailLogFields {
  requestId: string;
  operation: 'update_email';
  result: string;
  actorProfileId?: string;
  targetProfileId?: string;
  companyId?: string | null;
  durationMs?: number;
  code?: string;
}

export function logUserEmailEvent(fields: UserEmailLogFields): void {
  // eslint-disable-next-line no-console
  console.log('[users:email]', JSON.stringify(fields));
}

// Alerta operacional — reservado para falhas graves que exigem revisão
// manual (ex.: email_compensation_failed, o Auth e profiles ficaram
// divergentes e a tentativa de restaurar o e-mail anterior também falhou).
// `safeDetail` precisa já chegar sanitizado — nunca o erro original (pode
// carregar stack/mensagem bruta de uma dependência), nunca e-mail completo.
export function logUserEmailAlert(context: string, safeDetail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[users:email:alert]', context, JSON.stringify(safeDetail));
}
