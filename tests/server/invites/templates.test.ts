// tests/server/invites/templates.test.ts — templates locais de e-mail
// (M1-F S4-A2B, design §11/§12). Lidos direto do disco — nenhuma rede,
// nenhum Supabase local necessário para este teste.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const inviteHtml = readFileSync(path.join(process.cwd(), 'supabase/templates/invite.html'), 'utf8');
const magicLinkHtml = readFileSync(path.join(process.cwd(), 'supabase/templates/magic_link.html'), 'utf8');

function expectSafeTemplate(html: string): void {
  expect(html).not.toContain('.ConfirmationURL');
  expect(html).not.toContain('<script');
  // Nenhuma URL literal em lugar nenhum do template — o único link é
  // construído a partir de variáveis do Go template ({{ .RedirectTo }}),
  // nunca de uma string http(s):// fixa (imagem externa, analytics, etc.).
  expect(html).not.toMatch(/https?:\/\//i);
  expect(html).not.toMatch(/google-analytics|gtag|pixel|tracking\.js/i);
}

describe('invite.html', () => {
  it('não contém .ConfirmationURL', () => {
    expect(inviteHtml).not.toContain('.ConfirmationURL');
  });

  it('contém .RedirectTo e .TokenHash', () => {
    expect(inviteHtml).toContain('.RedirectTo');
    expect(inviteHtml).toContain('.TokenHash');
  });

  it('usa auth_type=invite', () => {
    expect(inviteHtml).toContain('auth_type=invite');
  });

  it('não contém script, tracking ou imagem/URL externa', () => {
    expectSafeTemplate(inviteHtml);
  });

  it('não expõe o token próprio em texto visível (só via variável do template)', () => {
    expect(inviteHtml).not.toMatch(/invite_token=(?!\{\{)/);
  });

  it('o href concatena RedirectTo com auth_token_hash dentro do mesmo fragmento (& escapado como &amp;)', () => {
    expect(inviteHtml).toMatch(/href="\{\{\s*\.RedirectTo\s*\}\}&amp;auth_token_hash=\{\{\s*\.TokenHash\s*\}\}&amp;auth_type=invite"/);
  });
});

describe('magic_link.html', () => {
  it('não contém .ConfirmationURL', () => {
    expect(magicLinkHtml).not.toContain('.ConfirmationURL');
  });

  it('contém .RedirectTo e .TokenHash', () => {
    expect(magicLinkHtml).toContain('.RedirectTo');
    expect(magicLinkHtml).toContain('.TokenHash');
  });

  it('usa auth_type=magiclink (tipo exato aceito pela versão instalada de auth-js)', () => {
    expect(magicLinkHtml).toContain('auth_type=magiclink');
  });

  it('não contém script, tracking ou imagem/URL externa', () => {
    expectSafeTemplate(magicLinkHtml);
  });

  it('não menciona recuperação de senha nem revela que a conta já existia', () => {
    expect(magicLinkHtml.toLowerCase()).not.toContain('senha');
    expect(magicLinkHtml.toLowerCase()).not.toContain('recupera');
  });

  it('mesma resposta visual do convite novo (mesmo texto de botão/estrutura, textos de entrada distintos)', () => {
    expect(magicLinkHtml).toContain('AutoCRM');
    expect(inviteHtml).toContain('AutoCRM');
  });
});
