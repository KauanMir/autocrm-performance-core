// lib/server/invites/token.ts — geração do token próprio de convite
// (M1-F S4-A2B). O token bruto SÓ existe em memória entre esta função e o
// envio via Supabase Auth (redirectTo) — nunca é persistido, logado ou
// devolvido na resposta HTTP. O banco só recebe token_hash.
import { randomBytes, createHash } from 'node:crypto';

export interface InviteToken {
  rawToken: string;
  tokenHash: string;
}

// 32 bytes aleatórios → base64url sem padding (Node já omite o `=` nesse
// encoding) → 43 caracteres URL-safe. tokenHash é SHA-256 hex minúsculo do
// rawToken, sempre 64 caracteres — mesmo formato validado por
// create_invite()/resend_invite() (`^[0-9a-f]{64}$`).
export function generateInviteToken(): InviteToken {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

// Link direto para o CRM, nunca para /auth/v1/verify. O token próprio vai
// SOMENTE no fragmento (nunca na query string) — o template do Supabase
// Auth (invite.html/magic_link.html) concatena auth_token_hash/auth_type
// dentro do mesmo fragmento, nunca criando uma segunda query string.
export function buildInviteRedirectUrl(appUrl: URL, rawToken: string): string {
  return `${appUrl.origin}/convite/aceitar#invite_token=${rawToken}`;
}
