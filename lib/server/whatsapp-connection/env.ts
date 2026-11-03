// lib/server/whatsapp-connection/env.ts — chave de cifragem dos access
// tokens do WhatsApp Cloud API. SERVER-ONLY, sem NEXT_PUBLIC_, sem default.
// Mensagem de erro contém só o nome da variável, nunca o valor.
//
// WHATSAPP_TOKEN_ENCRYPTION_KEY_V1 — AES-256-GCM, 32 bytes em hex minúsculo
// (64 caracteres). SEPARADA de META_TOKEN_ENCRYPTION_KEY_V1 (Lead Ads): um
// vazamento/rotação de uma integração não afeta a outra. Nunca reutilizar
// META_APP_SECRET, META_OAUTH_STATE_SECRET, INVITE_RATE_LIMIT_PEPPER nem a
// chave da Meta.
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export class InvalidWhatsAppTokenEncryptionKeyError extends Error {
  constructor() {
    super('whatsapp_token_encryption_key_v1_invalid');
    this.name = 'InvalidWhatsAppTokenEncryptionKeyError';
  }
}

export function getWhatsAppTokenEncryptionKeyV1(): Buffer {
  const raw = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY_V1;
  if (!raw || !KEY_PATTERN.test(raw)) {
    throw new InvalidWhatsAppTokenEncryptionKeyError();
  }
  return Buffer.from(raw, 'hex');
}
