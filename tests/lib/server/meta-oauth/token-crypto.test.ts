// META-PERSISTENCE P1 — cifragem AES-256-GCM dos Page Access Tokens.
// Tokens e chaves são FAKE, óbvios e de teste. Sem rede, sem banco, sem log.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptMetaPageToken,
  encryptMetaPageToken,
  MetaTokenCryptoError,
  type MetaTokenCryptoErrorCode,
} from '@/lib/server/meta-oauth/token-crypto';
import {
  getMetaTokenEncryptionKeyV1,
  InvalidMetaTokenEncryptionKeyError,
} from '@/lib/server/meta-oauth/env';

const FAKE_TOKEN = 'fake-page-token-test-only-0001';
const COMPANY_ID = '0a0a0a0a-0000-4000-8000-00000000c0de';
const OTHER_COMPANY_ID = '0b0b0b0b-0000-4000-8000-00000000c0de';
const PAGE_ID = '100000000000001';
const OTHER_PAGE_ID = '100000000000002';
const KEY_A = Buffer.alloc(32, 0x11);
const KEY_B = Buffer.alloc(32, 0x22);
const KEY_A_HEX = '11'.repeat(32);

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

function expectCode(fn: () => unknown, code: MetaTokenCryptoErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(MetaTokenCryptoError);
  expect((caught as MetaTokenCryptoError).code).toBe(code);
}

function encryptFixture(overrides: Partial<{ plaintextToken: string; companyId: string; pageId: string; key: Buffer }> = {}): string {
  return encryptMetaPageToken({
    plaintextToken: FAKE_TOKEN,
    companyId: COMPANY_ID,
    pageId: PAGE_ID,
    key: KEY_A,
    ...overrides,
  });
}

// Reescreve um segmento base64url mantendo-o canônico (válido, mas diferente).
function mutateSegment(envelope: string, index: number, mutate: (buf: Buffer) => Buffer): string {
  const parts = envelope.split('.');
  parts[index] = mutate(Buffer.from(parts[index], 'base64url')).toString('base64url');
  return parts.join('.');
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('encryptMetaPageToken / decryptMetaPageToken — round-trip e formato', () => {
  it('1. round-trip exato devolve o mesmo plaintext', () => {
    const envelope = encryptFixture();
    expect(decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A })).toBe(FAKE_TOKEN);
  });

  it('2. duas cifragens do mesmo token geram ciphertexts diferentes (IV aleatório)', () => {
    const first = encryptFixture();
    const second = encryptFixture();
    expect(first).not.toBe(second);
    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
  });

  it('envelope segue v1.<iv 12B>.<tag 16B>.<ct>, todos base64url', () => {
    const envelope = encryptFixture();
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(Buffer.from(envelope.split('.')[1], 'base64url')).toHaveLength(12);
    expect(Buffer.from(envelope.split('.')[2], 'base64url')).toHaveLength(16);
  });

  it('companyId em maiúsculas normaliza para minúsculas (mesmo AAD)', () => {
    const envelope = encryptFixture({ companyId: COMPANY_ID.toUpperCase() });
    expect(decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A })).toBe(FAKE_TOKEN);
  });
});

describe('decryptMetaPageToken — rejeições de contexto e chave', () => {
  it('3. company_id errado falha (AAD diferente)', () => {
    const envelope = encryptFixture();
    expectCode(
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: OTHER_COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'decrypt_failed',
    );
  });

  it('4. page_id errado falha (AAD diferente)', () => {
    const envelope = encryptFixture();
    expectCode(
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: OTHER_PAGE_ID, key: KEY_A }),
      'decrypt_failed',
    );
  });

  it('5. chave errada falha', () => {
    const envelope = encryptFixture();
    expectCode(
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_B }),
      'decrypt_failed',
    );
  });
});

describe('decryptMetaPageToken — adulteração', () => {
  it('6. ciphertext adulterado falha', () => {
    const envelope = encryptFixture();
    const tampered = mutateSegment(envelope, 3, (buf) => Buffer.from(buf.map((b, i) => (i === 0 ? b ^ 0xff : b))));
    expectCode(
      () => decryptMetaPageToken({ ciphertext: tampered, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'decrypt_failed',
    );
  });

  it('7. tag adulterada falha', () => {
    const envelope = encryptFixture();
    const tampered = mutateSegment(envelope, 2, (buf) => Buffer.from(buf.map((b, i) => (i === 0 ? b ^ 0x01 : b))));
    expectCode(
      () => decryptMetaPageToken({ ciphertext: tampered, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'decrypt_failed',
    );
  });

  it('8a. IV adulterado (12 bytes válidos, diferentes) falha', () => {
    const envelope = encryptFixture();
    const tampered = mutateSegment(envelope, 1, (buf) => Buffer.from(buf.map((b, i) => (i === 0 ? b ^ 0x01 : b))));
    expectCode(
      () => decryptMetaPageToken({ ciphertext: tampered, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'decrypt_failed',
    );
  });

  it('8b. IV malformado (tamanho errado) falha como iv_invalid', () => {
    const envelope = encryptFixture();
    const parts = envelope.split('.');
    parts[1] = Buffer.alloc(11, 1).toString('base64url');
    expectCode(
      () => decryptMetaPageToken({ ciphertext: parts.join('.'), companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'iv_invalid',
    );
  });

  it('8c. tag com bits extras no último caractere (não canônica) falha como tag_invalid', () => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const envelope = encryptFixture();
    const parts = envelope.split('.');
    const tag = parts[2];
    const lastIndex = ALPHABET.indexOf(tag[tag.length - 1]);
    parts[2] = tag.slice(0, -1) + ALPHABET[lastIndex ^ 1];
    expectCode(
      () => decryptMetaPageToken({ ciphertext: parts.join('.'), companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'tag_invalid',
    );
  });
});

describe('decryptMetaPageToken — envelope e versão', () => {
  it('9. envelope malformado falha (partes faltando, caracteres inválidos, vazio)', () => {
    const base = { companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A };
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: 'v1.abc.def' }), 'envelope_malformed');
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: 'v1.a+b/c=.x.y' }), 'envelope_malformed');
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: '' }), 'envelope_malformed');
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: 42 as unknown as string }), 'envelope_malformed');
  });

  it('9b. ciphertext vazio após a tag falha como envelope_malformed', () => {
    const envelope = encryptFixture();
    const [v, iv, tag] = envelope.split('.');
    expectCode(
      () => decryptMetaPageToken({ ciphertext: `${v}.${iv}.${tag}.`, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      'envelope_malformed',
    );
  });

  it('10. versão desconhecida falha (v2, v0)', () => {
    const envelope = encryptFixture();
    const body = envelope.slice(envelope.indexOf('.') + 1);
    const base = { companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A };
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: `v2.${body}` }), 'envelope_version_unknown');
    expectCode(() => decryptMetaPageToken({ ...base, ciphertext: `v0.${body}` }), 'envelope_version_unknown');
  });
});

describe('chave e contexto — fail closed', () => {
  it('11. chave com tamanho inválido falha (31, 33 bytes, string)', () => {
    const base = { companyId: COMPANY_ID, pageId: PAGE_ID, plaintextToken: FAKE_TOKEN };
    expectCode(() => encryptMetaPageToken({ ...base, key: Buffer.alloc(31, 1) }), 'key_invalid');
    expectCode(() => encryptMetaPageToken({ ...base, key: Buffer.alloc(33, 1) }), 'key_invalid');
    expectCode(() => encryptMetaPageToken({ ...base, key: KEY_A_HEX as unknown as Buffer }), 'key_invalid');
    const envelope = encryptFixture();
    expectCode(
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: Buffer.alloc(16, 1) }),
      'key_invalid',
    );
  });

  it('contexto inválido (company não-UUID, page com letras) falha como context_invalid', () => {
    expectCode(() => encryptFixture({ companyId: 'not-a-uuid' }), 'context_invalid');
    expectCode(() => encryptFixture({ pageId: 'abc' }), 'context_invalid');
    expectCode(() => encryptFixture({ pageId: '' }), 'context_invalid');
  });

  it('plaintext vazio ou não-string falha como plaintext_invalid', () => {
    expectCode(() => encryptFixture({ plaintextToken: '' }), 'plaintext_invalid');
    expectCode(() => encryptFixture({ plaintextToken: 123 as unknown as string }), 'plaintext_invalid');
  });
});

describe('env META_TOKEN_ENCRYPTION_KEY_V1 — fail closed', () => {
  it('12. env ausente falha fechado, sem default', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', undefined as unknown as string);
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
  });

  it('13. env não-hex ou com tamanho errado falha', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', 'zz'.repeat(32));
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '11'.repeat(31));
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', 'ab'.repeat(32).toUpperCase());
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', `${KEY_A_HEX} `);
    expect(() => getMetaTokenEncryptionKeyV1()).toThrow(InvalidMetaTokenEncryptionKeyError);
  });

  it('env válida (64 hex minúsculos) vira Buffer de 32 bytes que cifra e decifra', () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_A_HEX);
    const key = getMetaTokenEncryptionKeyV1();
    expect(key).toHaveLength(32);
    const envelope = encryptMetaPageToken({ plaintextToken: FAKE_TOKEN, companyId: COMPANY_ID, pageId: PAGE_ID, key });
    expect(decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key })).toBe(FAKE_TOKEN);
  });

  it('o erro de env contém só o nome da variável, nunca o valor', () => {
    const badValue = 'zz'.repeat(32);
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', badValue);
    try {
      getMetaTokenEncryptionKeyV1();
      throw new Error('expected throw');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(badValue);
      expect(String((err as Error).stack ?? '')).not.toContain(badValue);
    }
  });
});

describe('segurança — erros, logs, rede e banco', () => {
  it('14. nenhum erro contém plaintext, chave ou ciphertext', () => {
    const envelope = encryptFixture();
    const cases: Array<() => unknown> = [
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: OTHER_COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      () => decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_B }),
      () => decryptMetaPageToken({ ciphertext: 'v9.x.y.z', companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A }),
      () => encryptFixture({ key: Buffer.alloc(5, 0x11) }),
      () => encryptFixture({ companyId: 'bad' }),
    ];
    for (const fn of cases) {
      try {
        fn();
        throw new Error('expected throw');
      } catch (err) {
        const text = `${(err as Error).message} ${(err as Error).stack ?? ''} ${JSON.stringify(err)}`;
        expect(text).not.toContain(FAKE_TOKEN);
        expect(text).not.toContain(KEY_A_HEX);
        expect(text).not.toContain(envelope);
      }
    }
  });

  it('15. nenhum console.* é chamado durante cifragem, decifragem e falhas', () => {
    const envelope = encryptFixture();
    decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A });
    expect(() => decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_B })).toThrow();
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('16. nenhuma rede: fetch nunca chamado', () => {
    const envelope = encryptFixture();
    decryptMetaPageToken({ ciphertext: envelope, companyId: COMPANY_ID, pageId: PAGE_ID, key: KEY_A });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('17/18. módulo não importa banco/Supabase nem faz I/O de rede', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'lib/server/meta-oauth/token-crypto.ts'), 'utf8');
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/console\./);
  });

  it('nenhum código de erro carrega valor sensível como mensagem', () => {
    const codes: MetaTokenCryptoErrorCode[] = [
      'key_invalid', 'context_invalid', 'plaintext_invalid', 'envelope_malformed',
      'envelope_version_unknown', 'iv_invalid', 'tag_invalid', 'decrypt_failed',
    ];
    for (const code of codes) {
      const err = new MetaTokenCryptoError(code);
      expect(err.message).toBe(code);
      expect(err.code).toBe(code);
    }
  });
});
