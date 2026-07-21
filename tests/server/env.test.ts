// tests/server/env.test.ts — validação de APP_URL (M1-F S4-A2B, design
// §7). Nunca aceitar path arbitrário, credenciais embutidas ou protocolo
// diferente de http/https; sempre normalizar sem barra final.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppUrl, InvalidAppUrlError, getInviteRateLimitPepper, InvalidInviteRateLimitPepperError } from '@/lib/server/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAppUrl', () => {
  it('aceita http://127.0.0.1:3000 (valor local)', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000');
    const url = getAppUrl();
    expect(url.origin).toBe('http://127.0.0.1:3000');
  });

  it('appUrl.origin nunca tem barra final (usado diretamente na concatenação do redirectTo)', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000/');
    const url = getAppUrl();
    expect(url.origin).not.toMatch(/\/$/);
  });

  it('remove barra final quando presente', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000/');
    const url = getAppUrl();
    expect(url.origin).toBe('http://127.0.0.1:3000');
  });

  it('aceita https em produção', () => {
    vi.stubEnv('APP_URL', 'https://app.example.com');
    const url = getAppUrl();
    expect(url.origin).toBe('https://app.example.com');
  });

  it('rejeita ausência de APP_URL', () => {
    vi.stubEnv('APP_URL', '');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita string não-URL', () => {
    vi.stubEnv('APP_URL', 'not a url');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita protocolo diferente de http/https', () => {
    vi.stubEnv('APP_URL', 'ftp://127.0.0.1:3000');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita credenciais embutidas (username/password)', () => {
    vi.stubEnv('APP_URL', 'http://user:pass@127.0.0.1:3000');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita path arbitrário', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000/algum/path');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita query string', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000?x=1');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });

  it('rejeita hash', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000#frag');
    expect(() => getAppUrl()).toThrow(InvalidAppUrlError);
  });
});

describe('getInviteRateLimitPepper', () => {
  const VALID_PEPPER = 'a'.repeat(64);

  it('aceita exatamente 64 caracteres hex minúsculos, devolvendo um Buffer de 32 bytes', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', VALID_PEPPER);
    const pepper = getInviteRateLimitPepper();
    expect(pepper).toBeInstanceOf(Buffer);
    expect(pepper.length).toBe(32);
  });

  it('rejeita ausência da variável', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', '');
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('rejeita string vazia explícita', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', '');
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('rejeita valor curto (63 caracteres)', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', 'a'.repeat(63));
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('rejeita valor longo (65 caracteres)', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', 'a'.repeat(65));
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('rejeita caixa alta (não normaliza silenciosamente)', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', 'A'.repeat(64));
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('rejeita caractere não hexadecimal', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', `${'a'.repeat(63)}g`);
    expect(() => getInviteRateLimitPepper()).toThrow(InvalidInviteRateLimitPepperError);
  });

  it('mensagem de erro nunca contém o valor recebido, só o nome da classe/variável', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', 'not-a-real-secret-value-should-never-leak');
    try {
      getInviteRateLimitPepper();
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('not-a-real-secret-value-should-never-leak');
      expect((error as Error).message).toBe('invite_rate_limit_pepper_invalid');
    }
  });

  it('sem cache entre chamadas: variável alterada entre duas leituras reflete o novo valor', () => {
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', VALID_PEPPER);
    const first = getInviteRateLimitPepper();
    const otherPepper = 'b'.repeat(64);
    vi.stubEnv('INVITE_RATE_LIMIT_PEPPER', otherPepper);
    const second = getInviteRateLimitPepper();
    expect(first.equals(second)).toBe(false);
  });
});
