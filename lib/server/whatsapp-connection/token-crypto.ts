// lib/server/whatsapp-connection/token-crypto.ts — cifragem em repouso do
// access token do WhatsApp Cloud API. SERVER-ONLY. Usa a primitiva genérica
// (lib/server/crypto/aead-envelope.ts) com chave e domínio de AAD PRÓPRIOS:
//
// AAD (amarra o ciphertext à conexão; mover o ciphertext para outra company
// ou outro número invalida a decifragem):
//   whatsapp-access-token:v<N>:<company_id minúsculo>:<phone_number_id>
//
// A versão da chave é a mesma do prefixo do envelope e da coluna
// token_key_version. Só V1 existe.
import { openAeadEnvelope, sealAeadEnvelope } from '@/lib/server/crypto/aead-envelope';
import { getWhatsAppTokenEncryptionKeyV1, InvalidWhatsAppTokenEncryptionKeyError } from './env';

export const WHATSAPP_TOKEN_KEY_VERSION = 1 as const;

const COMPANY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,30}$/;

export class WhatsAppTokenContextError extends Error {
  constructor() {
    super('whatsapp_token_context_invalid');
    this.name = 'WhatsAppTokenContextError';
  }
}

export interface WhatsAppTokenContext {
  companyId: string;
  phoneNumberId: string;
  keyVersion: number;
}

function buildAad(context: WhatsAppTokenContext): string {
  const companyId = typeof context.companyId === 'string' ? context.companyId.toLowerCase() : '';
  if (!COMPANY_ID_PATTERN.test(companyId) || !PHONE_NUMBER_ID_PATTERN.test(context.phoneNumberId ?? '')) {
    throw new WhatsAppTokenContextError();
  }
  return `whatsapp-access-token:v${context.keyVersion}:${companyId}:${context.phoneNumberId}`;
}

// Ponto único que liga versão → chave. Versão desconhecida = falha fechada.
export function getWhatsAppTokenKeyForVersion(keyVersion: number): Buffer {
  if (keyVersion !== WHATSAPP_TOKEN_KEY_VERSION) {
    throw new InvalidWhatsAppTokenEncryptionKeyError();
  }
  return getWhatsAppTokenEncryptionKeyV1();
}

export function encryptWhatsAppAccessToken(
  input: WhatsAppTokenContext & { plaintextToken: string; key: Buffer },
): string {
  return sealAeadEnvelope({
    plaintext: input.plaintextToken,
    key: input.key,
    aad: buildAad(input),
    version: `v${input.keyVersion}`,
  });
}

export function decryptWhatsAppAccessToken(
  input: WhatsAppTokenContext & { ciphertext: string; key: Buffer },
): string {
  return openAeadEnvelope({
    envelope: input.ciphertext,
    key: input.key,
    aad: buildAad(input),
    version: `v${input.keyVersion}`,
  });
}
