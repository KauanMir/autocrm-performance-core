// tests/lib/server/whatsapp-connection/capture-crypto.test.ts — W2B-5. Cifragem
// autenticada com AAD vinculado à empresa e ao contexto, e HMAC de contato.
// Chaves fictícias, sem rede e sem banco.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AeadEnvelopeError } from '@/lib/server/crypto/aead-envelope';
import {
  clearWhatsAppCaptureKeys,
  computeWhatsAppContactHmac,
  decryptWhatsAppContactPii,
  decryptWhatsAppMessageContent,
  encryptWhatsAppContactPii,
  encryptWhatsAppMessageContent,
  loadWhatsAppCaptureKeys,
  WhatsAppCaptureContextError,
} from '@/lib/server/whatsapp-connection/capture-crypto';
import { encryptWhatsAppAccessToken, decryptWhatsAppAccessToken } from '@/lib/server/whatsapp-connection/token-crypto';
import { InvalidWhatsAppCaptureKeyError } from '@/lib/server/whatsapp-connection/env';
import { MAX_INBOUND_TEXT_LENGTH, type InboundContact } from '@/lib/server/whatsapp-webhook/inbound-parser';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 8);
const COMPANY_A = 'fa3eeeee-1111-4111-8111-111111111111';
const COMPANY_B = 'fa3eeeee-2222-4222-8222-222222222222';
const CONNECTION = 'fa3a0000-0000-4000-8000-00000000000a';
const OTHER_CONNECTION = 'fa3a0000-0000-4000-8000-00000000000b';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const PII_REF = '11111111-1111-4111-8111-111111111111';
const OTHER_REF = '22222222-2222-4222-8222-222222222222';

const payload = {
  wamid: 'wamid.ABC',
  content: { kind: 'text' as const, text: 'Olá, tudo bem? ✅', truncated: false },
  repliedToWamid: null,
};
const contact: InboundContact = { phone: '5511987654321', bsuid: null, parentBsuid: null, displayName: 'Fulana' };

const context = { companyId: COMPANY_A, connectionId: CONNECTION, messageIdHash: HASH };

afterEach(() => vi.unstubAllEnvs());

describe('envelope de mensagem', () => {
  const ciphertext = () => encryptWhatsAppMessageContent({ ...context, payload, key: KEY });

  it('ida e volta preserva conteúdo, inclusive acentos e emoji', () => {
    expect(decryptWhatsAppMessageContent({ ...context, ciphertext: ciphertext(), key: KEY })).toEqual(payload);
  });

  it('formato do envelope v1, sem texto legível', () => {
    const value = ciphertext();
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(value).not.toContain('Olá');
    expect(value).not.toContain('wamid');
  });

  it('IV aleatório: mesma entrada gera ciphertext diferente', () => {
    expect(ciphertext()).not.toBe(ciphertext());
  });

  it.each([
    ['outra empresa', { companyId: COMPANY_B }],
    ['outra conexão', { connectionId: OTHER_CONNECTION }],
    ['outra mensagem', { messageIdHash: OTHER_HASH }],
  ])('não decifra em %s', (_label, over) => {
    expect(() => decryptWhatsAppMessageContent({ ...context, ...over, ciphertext: ciphertext(), key: KEY }))
      .toThrow(AeadEnvelopeError);
  });

  it('não decifra com outra chave', () => {
    expect(() => decryptWhatsAppMessageContent({ ...context, ciphertext: ciphertext(), key: OTHER_KEY })).toThrow(AeadEnvelopeError);
  });

  it('pior caso do parser cabe no limite do banco: nunca vira 503 permanente', () => {
    const ciphertext = encryptWhatsAppMessageContent({
      ...context,
      key: KEY,
      payload: {
        wamid: 'w'.repeat(512),
        repliedToWamid: 'w'.repeat(512),
        content: { kind: 'text', text: '\u0001'.repeat(MAX_INBOUND_TEXT_LENGTH), truncated: true },
      },
    });
    expect(ciphertext.length).toBeGreaterThan(65536);
    expect(ciphertext.length).toBeLessThanOrEqual(131072);
  });

  it('adulteração é detectada', () => {
    const parts = ciphertext().split('.');
    const tampered = Buffer.from(parts[3], 'base64url');
    tampered[0] ^= 1;
    parts[3] = tampered.toString('base64url');
    expect(() => decryptWhatsAppMessageContent({ ...context, ciphertext: parts.join('.'), key: KEY })).toThrow(AeadEnvelopeError);
  });

  it.each([
    ['empresa inválida', { companyId: 'x' }],
    ['conexão inválida', { connectionId: 'x' }],
    ['hash inválido', { messageIdHash: 'x' }],
  ])('%s é recusado antes de cifrar', (_label, over) => {
    expect(() => encryptWhatsAppMessageContent({ ...context, ...over, payload, key: KEY })).toThrow(WhatsAppCaptureContextError);
  });

  it('erros não trazem o conteúdo', () => {
    try {
      encryptWhatsAppMessageContent({ ...context, payload, key: Buffer.alloc(8) });
      throw new Error('deveria falhar');
    } catch (error) {
      expect(String(error)).not.toContain(payload.content.text);
    }
  });
});

describe('envelope de contato', () => {
  const ciphertext = () => encryptWhatsAppContactPii({ companyId: COMPANY_A, piiRef: PII_REF, contact, key: KEY });

  it('ida e volta', () => {
    expect(decryptWhatsAppContactPii({ companyId: COMPANY_A, piiRef: PII_REF, ciphertext: ciphertext(), key: KEY })).toEqual(contact);
  });

  it('sem telefone ou nome legíveis', () => {
    expect(ciphertext()).not.toContain('5511987654321');
    expect(ciphertext()).not.toContain('Fulana');
  });

  it.each([
    ['outra empresa', { companyId: COMPANY_B }],
    ['outra referência', { piiRef: OTHER_REF }],
  ])('não decifra em %s', (_label, over) => {
    expect(() => decryptWhatsAppContactPii({ companyId: COMPANY_A, piiRef: PII_REF, ...over, ciphertext: ciphertext(), key: KEY }))
      .toThrow(AeadEnvelopeError);
  });
});

describe('separação de domínios', () => {
  it('envelope de mensagem não abre como contato', () => {
    const ciphertext = encryptWhatsAppMessageContent({ ...context, payload, key: KEY });
    expect(() => decryptWhatsAppContactPii({ companyId: COMPANY_A, piiRef: PII_REF, ciphertext, key: KEY })).toThrow(AeadEnvelopeError);
  });

  it('envelope de token não abre como mensagem, com a mesma chave', () => {
    const ciphertext = encryptWhatsAppAccessToken({
      companyId: COMPANY_A, phoneNumberId: '123', keyVersion: 1, plaintextToken: 'token-fake', key: KEY,
    });
    expect(() => decryptWhatsAppMessageContent({ ...context, ciphertext, key: KEY })).toThrow(AeadEnvelopeError);
  });

  it('envelope de mensagem não abre como token', () => {
    const ciphertext = encryptWhatsAppMessageContent({ ...context, payload, key: KEY });
    expect(() => decryptWhatsAppAccessToken({ companyId: COMPANY_A, phoneNumberId: '123', keyVersion: 1, ciphertext, key: KEY }))
      .toThrow(AeadEnvelopeError);
  });
});

describe('HMAC de contato', () => {
  const hmac = (over: Partial<Parameters<typeof computeWhatsAppContactHmac>[0]> = {}) =>
    computeWhatsAppContactHmac({ kind: 'phone', companyId: COMPANY_A, value: '5511987654321', key: KEY, ...over });

  it('determinístico: mesma pessoa, mesma empresa', () => {
    expect(hmac()).toBe(hmac());
    expect(hmac()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('varia por empresa, tipo, valor e chave', () => {
    const values = [hmac(), hmac({ companyId: COMPANY_B }), hmac({ kind: 'bsuid' }), hmac({ value: '5511900000000' }), hmac({ key: OTHER_KEY })];
    expect(new Set(values).size).toBe(values.length);
  });

  it('empresa com caixa diferente gera o mesmo valor', () => {
    expect(hmac({ companyId: COMPANY_A.toUpperCase() })).toBe(hmac());
  });

  it('valor vazio é recusado', () => {
    expect(() => hmac({ value: '' })).toThrow(WhatsAppCaptureContextError);
  });
});

describe('chaves', () => {
  it('carrega e zera', () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'c'.repeat(64));
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', 'd'.repeat(64));
    const keys = loadWhatsAppCaptureKeys();
    expect(keys.content).toHaveLength(32);
    clearWhatsAppCaptureKeys(keys);
    expect(keys.content.every((byte) => byte === 0)).toBe(true);
    expect(keys.contactHmac.every((byte) => byte === 0)).toBe(true);
  });

  it('falha na segunda chave zera a primeira', () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'c'.repeat(64));
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', 'curta');
    const fill = vi.spyOn(Buffer.prototype, 'fill');
    expect(() => loadWhatsAppCaptureKeys()).toThrow(InvalidWhatsAppCaptureKeyError);
    expect(fill).toHaveBeenCalledWith(0);
  });

  it.each([
    ['WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', ''],
    ['WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'C'.repeat(64)],
    ['WHATSAPP_CONTACT_HMAC_KEY_V1', 'd'.repeat(63)],
  ])('%s inválida falha com erro que só cita o nome', (name, value) => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'c'.repeat(64));
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', 'd'.repeat(64));
    vi.stubEnv(name, value);
    try {
      loadWhatsAppCaptureKeys();
      throw new Error('deveria falhar');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWhatsAppCaptureKeyError);
      if (value) expect(String(error)).not.toContain(value);
    }
  });
});
