// lib/server/crypto/aead-envelope.ts — primitiva genérica AES-256-GCM com
// envelope versionado e AAD. SERVER-ONLY. Módulo puro: sem rede, sem banco,
// sem log, sem env. Cada integração escolhe a PRÓPRIA chave e o PRÓPRIO
// domínio de AAD (separação lógica de segredos) — este módulo só cifra.
//
// Mesmo formato do envelope já aprovado para os Page Access Tokens da Meta
// (lib/server/meta-oauth/token-crypto.ts, que NÃO é alterado nem migrado
// aqui):
//   v<N>.<iv base64url, 12 bytes>.<tag base64url, 16 bytes>.<ciphertext base64url>
//
// IV: 12 bytes aleatórios por cifragem. Erros carregam só um código fixo —
// nunca plaintext, chave, IV, tag, AAD ou ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const VERSION_PATTERN = /^v[1-9][0-9]{0,3}$/;
const ENVELOPE_PATTERN = /^(v[0-9]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export type AeadEnvelopeErrorCode =
  | 'key_invalid'
  | 'aad_invalid'
  | 'version_invalid'
  | 'plaintext_invalid'
  | 'envelope_malformed'
  | 'envelope_version_unknown'
  | 'iv_invalid'
  | 'tag_invalid'
  | 'decrypt_failed';

export class AeadEnvelopeError extends Error {
  readonly code: AeadEnvelopeErrorCode;

  constructor(code: AeadEnvelopeErrorCode) {
    super(code);
    this.name = 'AeadEnvelopeError';
    this.code = code;
  }
}

export interface SealInput {
  plaintext: string;
  key: Buffer;
  aad: string;
  // Prefixo do envelope, ex.: "v1". Deve casar com a versão da chave.
  version: string;
}

export interface OpenInput {
  envelope: string;
  key: Buffer;
  aad: string;
  version: string;
}

function assertParams(key: unknown, aad: unknown, version: unknown): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new AeadEnvelopeError('key_invalid');
  }
  if (typeof aad !== 'string' || aad.length === 0) {
    throw new AeadEnvelopeError('aad_invalid');
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new AeadEnvelopeError('version_invalid');
  }
}

export function sealAeadEnvelope(input: SealInput): string {
  assertParams(input.key, input.aad, input.version);
  if (typeof input.plaintext !== 'string' || input.plaintext.length === 0) {
    throw new AeadEnvelopeError('plaintext_invalid');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, input.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(input.aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [input.version, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decodeCanonical(value: string, expectedBytes: number | null): Buffer | null {
  const buf = Buffer.from(value, 'base64url');
  if (buf.length === 0) return null;
  if (expectedBytes !== null && buf.length !== expectedBytes) return null;
  if (buf.toString('base64url') !== value) return null;
  return buf;
}

export function openAeadEnvelope(input: OpenInput): string {
  assertParams(input.key, input.aad, input.version);
  if (typeof input.envelope !== 'string') {
    throw new AeadEnvelopeError('envelope_malformed');
  }
  const match = ENVELOPE_PATTERN.exec(input.envelope);
  if (!match) {
    throw new AeadEnvelopeError('envelope_malformed');
  }
  const [, version, ivPart, tagPart, ctPart] = match;
  if (version !== input.version) {
    throw new AeadEnvelopeError('envelope_version_unknown');
  }

  const iv = decodeCanonical(ivPart, IV_BYTES);
  if (!iv) throw new AeadEnvelopeError('iv_invalid');
  const tag = decodeCanonical(tagPart, TAG_BYTES);
  if (!tag) throw new AeadEnvelopeError('tag_invalid');
  const ciphertext = decodeCanonical(ctPart, null);
  if (!ciphertext) throw new AeadEnvelopeError('envelope_malformed');

  try {
    const decipher = createDecipheriv(ALGORITHM, input.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(input.aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new AeadEnvelopeError('decrypt_failed');
  }
}
