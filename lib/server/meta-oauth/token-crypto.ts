// lib/server/meta-oauth/token-crypto.ts — cifragem de Page Access Tokens
// da Meta em repouso. SERVER-ONLY. Módulo puro: sem rede, sem banco, sem
// log. A chave entra por parâmetro (quem carrega a env é env.ts).
//
// Envelope (versionado):
//   v1.<iv base64url, 12 bytes>.<tag base64url, 16 bytes>.<ciphertext base64url>
//
// AAD (amarra o ciphertext ao contexto; trocar qualquer parte invalida):
//   meta-page-token:v1:<company_id minúsculo>:<page_id>
//
// IV: 12 bytes aleatórios de randomBytes por cifragem (96 bits; sem contador,
// sem estado). O volume de cifragens por chave é limitado pela rotação de versão.
// Erros carregam só um código fixo — nunca plaintext, chave, IV, tag ou
// ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const META_TOKEN_ENVELOPE_VERSION = 'v1' as const;

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const COMPANY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_ID_PATTERN = /^[0-9]{1,30}$/;
const ENVELOPE_PATTERN = /^(v[0-9]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export type MetaTokenCryptoErrorCode =
  | 'key_invalid'
  | 'context_invalid'
  | 'plaintext_invalid'
  | 'envelope_malformed'
  | 'envelope_version_unknown'
  | 'iv_invalid'
  | 'tag_invalid'
  | 'decrypt_failed';

export class MetaTokenCryptoError extends Error {
  readonly code: MetaTokenCryptoErrorCode;

  constructor(code: MetaTokenCryptoErrorCode) {
    super(code);
    this.name = 'MetaTokenCryptoError';
    this.code = code;
  }
}

export interface MetaPageTokenContext {
  companyId: string;
  pageId: string;
}

export interface EncryptMetaPageTokenInput extends MetaPageTokenContext {
  plaintextToken: string;
  key: Buffer;
}

export interface DecryptMetaPageTokenInput extends MetaPageTokenContext {
  ciphertext: string;
  key: Buffer;
}

function assertKey(key: unknown): asserts key is Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new MetaTokenCryptoError('key_invalid');
  }
}

function buildAad(context: MetaPageTokenContext): Buffer {
  const companyId = typeof context.companyId === 'string' ? context.companyId.toLowerCase() : '';
  const pageId = typeof context.pageId === 'string' ? context.pageId : '';
  if (!COMPANY_ID_PATTERN.test(companyId) || !PAGE_ID_PATTERN.test(pageId)) {
    throw new MetaTokenCryptoError('context_invalid');
  }
  return Buffer.from(`meta-page-token:${META_TOKEN_ENVELOPE_VERSION}:${companyId}:${pageId}`, 'utf8');
}

export function encryptMetaPageToken(input: EncryptMetaPageTokenInput): string {
  assertKey(input.key);
  if (typeof input.plaintextToken !== 'string' || input.plaintextToken.length === 0) {
    throw new MetaTokenCryptoError('plaintext_invalid');
  }
  const aad = buildAad(input);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, input.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(input.plaintextToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    META_TOKEN_ENVELOPE_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decodeCanonical(value: string, expectedBytes: number | null): Buffer | null {
  const buf = Buffer.from(value, 'base64url');
  if (buf.length === 0) return null;
  if (expectedBytes !== null && buf.length !== expectedBytes) return null;
  if (buf.toString('base64url') !== value) return null;
  return buf;
}

export function decryptMetaPageToken(input: DecryptMetaPageTokenInput): string {
  assertKey(input.key);
  const aad = buildAad(input);

  if (typeof input.ciphertext !== 'string') {
    throw new MetaTokenCryptoError('envelope_malformed');
  }
  const match = ENVELOPE_PATTERN.exec(input.ciphertext);
  if (!match) {
    throw new MetaTokenCryptoError('envelope_malformed');
  }
  const [, version, ivPart, tagPart, ctPart] = match;
  if (version !== META_TOKEN_ENVELOPE_VERSION) {
    throw new MetaTokenCryptoError('envelope_version_unknown');
  }

  const iv = decodeCanonical(ivPart, IV_BYTES);
  if (!iv) throw new MetaTokenCryptoError('iv_invalid');
  const tag = decodeCanonical(tagPart, TAG_BYTES);
  if (!tag) throw new MetaTokenCryptoError('tag_invalid');
  const ciphertext = decodeCanonical(ctPart, null);
  if (!ciphertext) throw new MetaTokenCryptoError('envelope_malformed');

  try {
    const decipher = createDecipheriv(ALGORITHM, input.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new MetaTokenCryptoError('decrypt_failed');
  }
}
