// Testes de lib/auth/recoveryLink.ts — parser puro do link de recuperação
// de senha (PILOT-P0-A1-EXEC-RECOVERY). Cobre os dois formatos reais que o
// Supabase Auth pode produzir para type=recovery, dependendo do template de
// e-mail configurado no dashboard (não confirmável a partir do repo).
import { describe, expect, it } from 'vitest';
import { parseRecoveryLink } from '@/lib/auth/recoveryLink';

describe('parseRecoveryLink — formato A: token_hash na query', () => {
  it('token_hash + type=recovery válidos: kind=token_hash', () => {
    const result = parseRecoveryLink('?token_hash=abc123&type=recovery', '');
    expect(result).toEqual({ kind: 'token_hash', tokenHash: 'abc123' });
  });

  it('type diferente de recovery: kind=none (mesmo com token_hash presente)', () => {
    const result = parseRecoveryLink('?token_hash=abc123&type=signup', '');
    expect(result).toEqual({ kind: 'none' });
  });

  it('token_hash ausente: kind=none', () => {
    const result = parseRecoveryLink('?type=recovery', '');
    expect(result).toEqual({ kind: 'none' });
  });

  it('token_hash vazio: kind=none', () => {
    const result = parseRecoveryLink('?token_hash=&type=recovery', '');
    expect(result).toEqual({ kind: 'none' });
  });
});

describe('parseRecoveryLink — formato B: access_token/refresh_token no hash (implícito)', () => {
  it('access_token + refresh_token + type=recovery válidos: kind=implicit_tokens', () => {
    const result = parseRecoveryLink('', '#access_token=at1&refresh_token=rt1&type=recovery&expires_in=3600');
    expect(result).toEqual({ kind: 'implicit_tokens', accessToken: 'at1', refreshToken: 'rt1' });
  });

  it('hash sem o # inicial também funciona', () => {
    const result = parseRecoveryLink('', 'access_token=at1&refresh_token=rt1&type=recovery');
    expect(result).toEqual({ kind: 'implicit_tokens', accessToken: 'at1', refreshToken: 'rt1' });
  });

  it('type diferente de recovery no hash: kind=none', () => {
    const result = parseRecoveryLink('', '#access_token=at1&refresh_token=rt1&type=signup');
    expect(result).toEqual({ kind: 'none' });
  });

  it('refresh_token ausente: kind=none', () => {
    const result = parseRecoveryLink('', '#access_token=at1&type=recovery');
    expect(result).toEqual({ kind: 'none' });
  });

  it('hash vazio: kind=none', () => {
    const result = parseRecoveryLink('', '');
    expect(result).toEqual({ kind: 'none' });
  });
});

describe('parseRecoveryLink — sem sinal nenhum de recovery', () => {
  it('query e hash vazios: kind=none', () => {
    expect(parseRecoveryLink('', '')).toEqual({ kind: 'none' });
  });

  it('query com parâmetros não relacionados: kind=none', () => {
    expect(parseRecoveryLink('?foo=bar', '')).toEqual({ kind: 'none' });
  });

  it('query prioriza token_hash mesmo se o hash também tiver algo (formato A vence)', () => {
    const result = parseRecoveryLink(
      '?token_hash=abc123&type=recovery',
      '#access_token=at1&refresh_token=rt1&type=recovery',
    );
    expect(result).toEqual({ kind: 'token_hash', tokenHash: 'abc123' });
  });
});
