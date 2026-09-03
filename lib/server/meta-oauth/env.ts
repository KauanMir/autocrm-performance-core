// lib/server/meta-oauth/env.ts — leitura/validação da variável server-only
// que assina o parâmetro OAuth `state` do "Login do Facebook para
// Empresas". Mesmo molde de lib/server/env.ts / lib/server/meta-webhook/
// env.ts: NUNCA prefixar NEXT_PUBLIC_, NUNCA importado por código
// client-side, NUNCA expõe o valor em erro/log (só o nome da variável).
//
// META_OAUTH_STATE_SECRET é uma chave HMAC INTERNA do CRM, dedicada só a
// este fim. NÃO é META_APP_SECRET (credencial da Meta) e NÃO é
// INVITE_RATE_LIMIT_PEPPER (hash de IP de convite) — domínios de
// confiança/rotação distintos.

export class InvalidMetaOAuthStateSecretError extends Error {
  constructor() {
    // Mensagem contém só o nome da variável, nunca o valor recebido.
    super('meta_oauth_state_secret_invalid');
    this.name = 'InvalidMetaOAuthStateSecretError';
  }
}

// Exatamente 32 bytes em hex minúsculo (64 caracteres) — mesmo formato de
// INVITE_RATE_LIMIT_PEPPER. Gere com: openssl rand -hex 32
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

export function getMetaOAuthStateSecret(): Buffer {
  const raw = process.env.META_OAUTH_STATE_SECRET;
  if (!raw || !SECRET_PATTERN.test(raw)) {
    throw new InvalidMetaOAuthStateSecretError();
  }
  return Buffer.from(raw, 'hex');
}
