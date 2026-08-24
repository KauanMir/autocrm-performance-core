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
    expect(metadata.title).toBe('KAPA CRM — Ranking & Operação');
  });

  it('title nunca menciona o nome antigo do produto', () => {
    expect(String(metadata.title)).not.toMatch(/AutoCRM/i);
  });
});

describe('app/convite/aceitar metadata — branding', () => {
  it('title e description mostram KAPA CRM, nunca o nome antigo', () => {
    expect(inviteMetadata.title).toBe('Convite — KAPA CRM');
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
