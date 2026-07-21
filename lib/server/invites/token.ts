// lib/server/invites/token.ts — geração do token próprio de convite
// (M1-F S4-A2B). O token bruto SÓ existe em memória entre esta função e o
// envio via Supabase Auth (redirectTo) — nunca é persistido, logado ou
// devolvido na resposta HTTP. O banco só recebe token_hash.
import { randomBytes, createHash } from 'node:crypto';

export interface InviteToken {
  rawToken: string;
  tokenHash: string;
}

// Mesmo formato produzido por randomBytes(32).toString('base64url') —
// 43 caracteres URL-safe, sem padding `=` (Node já omite nesse encoding).
// Usado pelos endpoints validate/accept (M1-F S4-C2A) para rejeitar
// qualquer entrada que não possa ter vindo de generateInviteToken(), sem
// normalização silenciosa (nunca trim/lowercase antes de validar).
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidRawInviteToken(value: string): boolean {
  return RAW_TOKEN_PATTERN.test(value);
}

// SHA-256 hex minúsculo do rawToken, sempre 64 caracteres — mesmo formato
// validado por create_invite()/resend_invite()/validate_invite_token()/
// accept_invite() (`^[0-9a-f]{64}$`). Extraída como função pura (M1-F
// S4-C2A) para que os endpoints validate/accept usem exatamente este
// mesmo algoritmo, nunca uma reimplementação divergente.
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// 32 bytes aleatórios → base64url sem padding (Node já omite o `=` nesse
// encoding) → 43 caracteres URL-safe.
export function generateInviteToken(): InviteToken {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashInviteToken(rawToken) };
}

// Link direto para o CRM, nunca para /auth/v1/verify. O token próprio vai
// SOMENTE no fragmento (nunca na query string) — o template do Supabase
// Auth (invite.html/magic_link.html) concatena auth_token_hash/auth_type
// dentro do mesmo fragmento, nunca criando uma segunda query string.
export function buildInviteRedirectUrl(appUrl: URL, rawToken: string): string {
  return `${appUrl.origin}/convite/aceitar#invite_token=${rawToken}`;
}
