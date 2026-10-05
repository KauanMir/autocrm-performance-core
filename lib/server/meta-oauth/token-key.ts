// lib/server/meta-oauth/token-key.ts — ponto único que liga a versão da chave
// de cifragem dos Page Access Tokens: token_key_version (coluna), o envelope
// (prefixo "v<N>") e a variável de ambiente META_TOKEN_ENCRYPTION_KEY_V<N>.
// Só V1 existe. Server-only. Nunca lê .env.local, nunca gera chave.
import { getMetaTokenEncryptionKeyV1, InvalidMetaTokenEncryptionKeyError } from './env';

export const META_TOKEN_KEY_VERSION = 1 as const;

export function envelopePrefixForKeyVersion(keyVersion: number): string {
  return `v${keyVersion}`;
}

export function getMetaTokenKeyForVersion(keyVersion: number): Buffer {
  if (keyVersion !== META_TOKEN_KEY_VERSION) {
    throw new InvalidMetaTokenEncryptionKeyError();
  }
  return getMetaTokenEncryptionKeyV1();
}

export function envelopeMatchesKeyVersion(ciphertext: string, keyVersion: number): boolean {
  return ciphertext.startsWith(`${envelopePrefixForKeyVersion(keyVersion)}.`);
}
