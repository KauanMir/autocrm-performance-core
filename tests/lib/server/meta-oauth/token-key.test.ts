// META-P4A — abstração de versão da chave: token_key_version, envelope e env.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { META_TOKEN_ENVELOPE_VERSION } from '@/lib/server/meta-oauth/token-crypto';
import {
  envelopeMatchesKeyVersion,
  envelopePrefixForKeyVersion,
  getMetaTokenKeyForVersion,
  META_TOKEN_KEY_VERSION,
} from '@/lib/server/meta-oauth/token-key';
import { InvalidMetaTokenEncryptionKeyError } from '@/lib/server/meta-oauth/env';

const FAKE_KEY_HEX = 'ab'.repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('token-key — versão única 1', () => {
  it('META_TOKEN_KEY_VERSION é 1', () => {
    expect(META_TOKEN_KEY_VERSION).toBe(1);
  });

  it('prefixo do envelope derivado da versão == versão do envelope de token-crypto', () => {
    expect(envelopePrefixForKeyVersion(META_TOKEN_KEY_VERSION)).toBe('v1');
    expect(envelopePrefixForKeyVersion(META_TOKEN_KEY_VERSION)).toBe(META_TOKEN_ENVELOPE_VERSION);
  });

  it('envelope v1 casa com a versão 1; envelope v2 não casa', () => {
    expect(envelopeMatchesKeyVersion('v1.a.b.c', 1)).toBe(true);
    expect(envelopeMatchesKeyVersion('v2.a.b.c', 1)).toBe(false);
    expect(envelopeMatchesKeyVersion('v10.a.b.c', 1)).toBe(false);
  });

  it('versão 1 devolve a chave de META_TOKEN_ENCRYPTION_KEY_V1 (32 bytes)', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);
    expect(getMetaTokenKeyForVersion(1)).toHaveLength(32);
  });

  it('versão diferente de 1 falha fechado, sem fallback', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);
    expect(() => getMetaTokenKeyForVersion(2)).toThrow(InvalidMetaTokenEncryptionKeyError);
    expect(() => getMetaTokenKeyForVersion(0)).toThrow(InvalidMetaTokenEncryptionKeyError);
  });

  it('chave V1 ausente falha fechado', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
    expect(() => getMetaTokenKeyForVersion(1)).toThrow(InvalidMetaTokenEncryptionKeyError);
  });
});
