// Cifragem do access token WhatsApp (W2A) + primitiva genérica AEAD. Chaves
// fake geradas em memória; nenhum segredo real.
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AeadEnvelopeError, openAeadEnvelope, sealAeadEnvelope } from '@/lib/server/crypto/aead-envelope';
import {
  decryptWhatsAppAccessToken,
  encryptWhatsAppAccessToken,
  getWhatsAppTokenKeyForVersion,
  WhatsAppTokenContextError,
} from '@/lib/server/whatsapp-connection/token-crypto';
import { InvalidWhatsAppTokenEncryptionKeyError } from '@/lib/server/whatsapp-connection/env';
import { decryptMetaPageToken, encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const COMPANY = 'fa4eeeee-1111-1111-1111-111111111111';
const OTHER_COMPANY = 'fa4eeeee-2222-2222-2222-222222222222';
const PHONE = '106540352242922';
const TOKEN = 'EAAG-fake-whatsapp-system-user-token-for-tests';

const ctx = { companyId: COMPANY, phoneNumberId: PHONE, keyVersion: 1 };

afterEach(() => vi.unstubAllEnvs());

describe('encrypt/decrypt WhatsApp access token', () => {
  it('roundtrip; envelope v1 e sem plaintext', () => {
    const ct = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    expect(ct.startsWith('v1.')).toBe(true);
    expect(ct.split('.')).toHaveLength(4);
    expect(ct).not.toContain(TOKEN);
    expect(decryptWhatsAppAccessToken({ ...ctx, ciphertext: ct, key: KEY })).toBe(TOKEN);
  });

  it('IV aleatório: cifrar duas vezes gera envelopes diferentes', () => {
    const a = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    const b = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    expect(a).not.toBe(b);
  });

  it('AAD amarra à company e ao phone_number_id: mover o ciphertext falha', () => {
    const ct = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    expect(() => decryptWhatsAppAccessToken({ ...ctx, companyId: OTHER_COMPANY, ciphertext: ct, key: KEY }))
      .toThrow(expect.objectContaining({ code: 'decrypt_failed' }));
    expect(() => decryptWhatsAppAccessToken({ ...ctx, phoneNumberId: '106540352242933', ciphertext: ct, key: KEY }))
      .toThrow(expect.objectContaining({ code: 'decrypt_failed' }));
  });

  it('chave errada, envelope adulterado ou versão diferente falham fechado', () => {
    const ct = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    expect(() => decryptWhatsAppAccessToken({ ...ctx, ciphertext: ct, key: OTHER_KEY })).toThrow(AeadEnvelopeError);
    const [v, iv, tag, body] = ct.split('.');
    const flipped = body.slice(0, -2) + (body.endsWith('A') ? 'B' : 'A') + body.slice(-1);
    expect(() => decryptWhatsAppAccessToken({ ...ctx, ciphertext: [v, iv, tag, flipped].join('.'), key: KEY }))
      .toThrow(AeadEnvelopeError);
    expect(() => decryptWhatsAppAccessToken({ ...ctx, ciphertext: ['v2', iv, tag, body].join('.'), key: KEY }))
      .toThrow(expect.objectContaining({ code: 'envelope_version_unknown' }));
    expect(() => decryptWhatsAppAccessToken({ ...ctx, ciphertext: 'garbage', key: KEY }))
      .toThrow(expect.objectContaining({ code: 'envelope_malformed' }));
  });

  it('contexto inválido falha antes de cifrar', () => {
    expect(() => encryptWhatsAppAccessToken({ ...ctx, companyId: 'x', plaintextToken: TOKEN, key: KEY }))
      .toThrow(WhatsAppTokenContextError);
    expect(() => encryptWhatsAppAccessToken({ ...ctx, phoneNumberId: '12a', plaintextToken: TOKEN, key: KEY }))
      .toThrow(WhatsAppTokenContextError);
    expect(() => encryptWhatsAppAccessToken({ ...ctx, plaintextToken: '', key: KEY }))
      .toThrow(expect.objectContaining({ code: 'plaintext_invalid' }));
    expect(() => encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: randomBytes(16) }))
      .toThrow(expect.objectContaining({ code: 'key_invalid' }));
  });

  it('erros nunca carregam token, chave ou ciphertext', () => {
    const ct = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    try {
      decryptWhatsAppAccessToken({ ...ctx, ciphertext: ct, key: OTHER_KEY });
    } catch (error) {
      const text = `${(error as Error).message} ${(error as Error).stack ?? ''}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(ct);
      expect(text).not.toContain(KEY.toString('hex'));
    }
  });
});

describe('separação lógica de Meta Lead Ads', () => {
  it('ciphertext do WhatsApp não abre com o módulo da Meta e vice-versa (domínios de AAD distintos)', () => {
    const wa = encryptWhatsAppAccessToken({ ...ctx, plaintextToken: TOKEN, key: KEY });
    expect(() => decryptMetaPageToken({ companyId: COMPANY, pageId: PHONE, ciphertext: wa, key: KEY })).toThrow();
    const meta = encryptMetaPageToken({ companyId: COMPANY, pageId: PHONE, plaintextToken: TOKEN, key: KEY });
    expect(() => decryptWhatsAppAccessToken({ ...ctx, ciphertext: meta, key: KEY })).toThrow();
  });

  it('chave vem de WHATSAPP_TOKEN_ENCRYPTION_KEY_V1, nunca de META_TOKEN_ENCRYPTION_KEY_V1', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', 'a'.repeat(64));
    vi.stubEnv('WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', '');
    expect(() => getWhatsAppTokenKeyForVersion(1)).toThrow(InvalidWhatsAppTokenEncryptionKeyError);
    vi.stubEnv('WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', 'b'.repeat(64));
    expect(getWhatsAppTokenKeyForVersion(1).toString('hex')).toBe('b'.repeat(64));
  });

  it('chave inválida (tamanho/maiúsculas) ou versão desconhecida falham fechado sem vazar valor', () => {
    for (const bad of ['b'.repeat(63), 'B'.repeat(64), 'z'.repeat(64)]) {
      vi.stubEnv('WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', bad);
      try {
        getWhatsAppTokenKeyForVersion(1);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toBe('whatsapp_token_encryption_key_v1_invalid');
      }
    }
    vi.stubEnv('WHATSAPP_TOKEN_ENCRYPTION_KEY_V1', 'b'.repeat(64));
    expect(() => getWhatsAppTokenKeyForVersion(2)).toThrow(InvalidWhatsAppTokenEncryptionKeyError);
  });
});

describe('aead-envelope (primitiva genérica)', () => {
  it('formato idêntico ao envelope Meta e AAD obrigatório', () => {
    const env = sealAeadEnvelope({ plaintext: 'x', key: KEY, aad: 'ctx', version: 'v1' });
    expect(env).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(openAeadEnvelope({ envelope: env, key: KEY, aad: 'ctx', version: 'v1' })).toBe('x');
    expect(() => openAeadEnvelope({ envelope: env, key: KEY, aad: 'other', version: 'v1' })).toThrow(AeadEnvelopeError);
    expect(() => sealAeadEnvelope({ plaintext: 'x', key: KEY, aad: '', version: 'v1' }))
      .toThrow(expect.objectContaining({ code: 'aad_invalid' }));
    expect(() => sealAeadEnvelope({ plaintext: 'x', key: KEY, aad: 'ctx', version: '1' }))
      .toThrow(expect.objectContaining({ code: 'version_invalid' }));
  });
});
