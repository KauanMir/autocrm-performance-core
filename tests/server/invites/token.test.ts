// tests/server/invites/token.test.ts — geração do token próprio de
// convite (M1-F S4-A2B). Nenhuma rede, nenhum mock — funções puras sobre
// node:crypto.
import { describe, expect, it } from 'vitest';
import { generateInviteToken, buildInviteRedirectUrl } from '@/lib/server/invites/token';

describe('generateInviteToken', () => {
  it('rawToken tem 43 caracteres base64url (32 bytes, sem padding)', () => {
    const { rawToken } = generateInviteToken();
    expect(rawToken).toHaveLength(43);
  });

  it('rawToken é estritamente URL-safe (sem +, /, =)', () => {
    const { rawToken } = generateInviteToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(rawToken).not.toContain('+');
    expect(rawToken).not.toContain('/');
    expect(rawToken).not.toContain('=');
  });

  it('duas chamadas geram rawToken/tokenHash diferentes', () => {
    const first = generateInviteToken();
    const second = generateInviteToken();
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it('tokenHash é SHA-256 hex minúsculo com exatamente 64 caracteres', () => {
    const { tokenHash } = generateInviteToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokenHash corresponde exatamente ao formato exigido pelas RPCs (^[0-9a-f]{64}$)', () => {
    for (let i = 0; i < 10; i += 1) {
      const { tokenHash } = generateInviteToken();
      expect(/^[0-9a-f]{64}$/.test(tokenHash)).toBe(true);
    }
  });
});

describe('buildInviteRedirectUrl', () => {
  it('coloca o token SOMENTE no fragmento, nunca na query string', () => {
    const appUrl = new URL('http://127.0.0.1:3000');
    const url = buildInviteRedirectUrl(appUrl, 'raw-token-abc');

    expect(url).toBe('http://127.0.0.1:3000/convite/aceitar#invite_token=raw-token-abc');
    expect(url).not.toContain('?');
  });

  it('usa a origem do appUrl, ignorando qualquer path/query pré-existente', () => {
    const appUrl = new URL('https://app.example.com/algum/path?x=1');
    const url = buildInviteRedirectUrl(appUrl, 'tok');

    expect(url).toBe('https://app.example.com/convite/aceitar#invite_token=tok');
  });

  it('zero token na query: o fragmento nunca é interpretado como query pelo URL parser', () => {
    const appUrl = new URL('http://127.0.0.1:3000');
    const url = buildInviteRedirectUrl(appUrl, 'raw-token-xyz');
    const parsed = new URL(url);

    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('#invite_token=raw-token-xyz');
  });
});
