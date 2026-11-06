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

// W2B-5 — chaves da captura de mensagens. Mesmo formato e mesma regra: 64 hex
// minúsculos, sem default, separadas entre si e da chave do token. Vazar ou
// rotacionar uma não afeta as demais.
//
// WHATSAPP_CONTENT_ENCRYPTION_KEY_V1 — AES-256-GCM de conteúdo e dados do contato.
// WHATSAPP_CONTACT_HMAC_KEY_V1 — HMAC-SHA-256 da identidade do contato.
export type WhatsAppCaptureKeyName = 'WHATSAPP_CONTENT_ENCRYPTION_KEY_V1' | 'WHATSAPP_CONTACT_HMAC_KEY_V1';

export class InvalidWhatsAppCaptureKeyError extends Error {
  constructor(public readonly variableName: WhatsAppCaptureKeyName) {
    super(`${variableName.toLowerCase()}_invalid`);
    this.name = 'InvalidWhatsAppCaptureKeyError';
  }
}

function readCaptureKey(name: WhatsAppCaptureKeyName): Buffer {
  const raw = process.env[name];
  if (!raw || !KEY_PATTERN.test(raw)) {
    throw new InvalidWhatsAppCaptureKeyError(name);
  }
  return Buffer.from(raw, 'hex');
}

export function getWhatsAppContentEncryptionKeyV1(): Buffer {
  return readCaptureKey('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1');
}

export function getWhatsAppContactHmacKeyV1(): Buffer {
  return readCaptureKey('WHATSAPP_CONTACT_HMAC_KEY_V1');
}
