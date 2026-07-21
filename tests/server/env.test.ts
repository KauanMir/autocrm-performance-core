// tests/server/env.test.ts — validação de APP_URL (M1-F S4-A2B, design
// §7). Nunca aceitar path arbitrário, credenciais embutidas ou protocolo
// diferente de http/https; sempre normalizar sem barra final.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';

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
