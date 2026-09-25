// Testes de metadata do RootLayout (KAPA-CRM-BRANDING-R1) — garante que o
// <title> do navegador reflete o branding visível correto, sem depender de
// renderização (Metadata do Next.js é lido estaticamente pelo framework).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata } from '@/app/layout';
import { metadata as inviteMetadata } from '@/app/convite/aceitar/page';

describe('app/layout metadata — branding', () => {
  it('title mostra KAPA CRM', () => {
    expect(metadata.title).toBe('KAPA CRM | Ranking & Operação');
  });

  it('title nunca menciona o nome antigo do produto', () => {
    expect(String(metadata.title)).not.toMatch(/AutoCRM/i);
  });
});

describe('app/convite/aceitar metadata — branding', () => {
  it('title e description mostram KAPA CRM, nunca o nome antigo', () => {
    expect(inviteMetadata.title).toBe('Convite | KAPA CRM');
    expect(inviteMetadata.description).toBe('Ative sua conta no KAPA CRM.');
    expect(String(inviteMetadata.title)).not.toMatch(/AutoCRM/i);
    expect(String(inviteMetadata.description)).not.toMatch(/AutoCRM/i);
  });
});

// app/favicon.ico é a convenção nativa do Next.js para servir a URL literal
// /favicon.ico (o request implícito que todo navegador dispara) — este
// teste é a guarda mínima contra o arquivo sumir/ficar vazio e o 404 do
// KAPA-CRM-BRANDING-R1-EXEC voltar sem ninguém notar.
describe('app/favicon.ico — regressão do 404', () => {
  it('existe e é um .ico válido, não vazio', () => {
    const bytes = readFileSync(join(process.cwd(), 'app', 'favicon.ico'));
    expect(bytes.length).toBeGreaterThan(0);
    // header ICO: reservado=0, tipo=1 (icon)
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
  });
});

// LOGIN_LAYOUT_AND_ICON_ADJUST_A2 — app/icon.svg é a convenção nativa do
// Next.js (App Router) para o favicon: mantém o quadrado de fundo amarelo
// já usado na aba do navegador, agora com um ícone de pódio (3 barras em
// degrau, mesmo motivo visual do pódio 2º/1º/3º da tela de login) no lugar
// do antigo ícone de carro — nunca emoji/caractere Unicode.
describe('app/icon.svg — favicon com ícone de pódio', () => {
  it('existe, mantém o fundo amarelo e desenha 3 barras de pódio (não mais o carro)', () => {
    const svg = readFileSync(join(process.cwd(), 'app', 'icon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('#E8CE72');
    expect(svg).toContain('#C9A227');
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4); // fundo + 3 barras do pódio
    expect(svg).not.toContain('M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13'); // path do antigo ícone "car"
  });

  it('não contém texto nem emoji — só forma vetorial', () => {
    const svg = readFileSync(join(process.cwd(), 'app', 'icon.svg'), 'utf8');
    expect(svg).not.toMatch(/<text/);
    // nenhum caractere fora do plano básico multilíngue (emoji ficam acima de U+FFFF)
    expect(/[\u{10000}-\u{10FFFF}]/u.test(svg)).toBe(false);
  });
});
