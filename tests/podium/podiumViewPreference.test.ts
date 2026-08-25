// Testes de lib/podium/podiumViewPreference.ts (PODIUM-COMPETITION-R1-EXEC
// §36-§39). Puro: sem React, localStorage real do jsdom (nunca mockado —
// exercita o contrato real de persistência).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPodiumViewPreference,
  setPodiumViewPreference,
  DEFAULT_PODIUM_VARIANT,
} from '@/lib/podium/podiumViewPreference';

beforeEach(() => {
  window.localStorage.clear();
});

describe('getPodiumViewPreference — default e ausência', () => {
  it('userId ausente/vazio: default D, nunca lê localStorage', () => {
    expect(getPodiumViewPreference(null)).toBe('D');
    expect(getPodiumViewPreference(undefined)).toBe('D');
    expect(getPodiumViewPreference('')).toBe('D');
    expect(DEFAULT_PODIUM_VARIANT).toBe('D');
  });

  it('nenhuma preferência salva ainda: default D', () => {
    expect(getPodiumViewPreference('user-1')).toBe('D');
  });
});

describe('getPodiumViewPreference / setPodiumViewPreference — persistência real', () => {
  it('salva e lê de volta cada variante válida (A/B/C/D)', () => {
    for (const variant of ['A', 'B', 'C', 'D'] as const) {
      setPodiumViewPreference('user-1', variant);
      expect(getPodiumViewPreference('user-1')).toBe(variant);
    }
  });

  it('valor inválido/corrompido no localStorage: fallback D, nunca lança', () => {
    window.localStorage.setItem('kapa-crm:podium-view:user-1', 'Z');
    expect(getPodiumViewPreference('user-1')).toBe('D');

    window.localStorage.setItem('kapa-crm:podium-view:user-1', '{"corrupted":true}');
    expect(getPodiumViewPreference('user-1')).toBe('D');
  });

  it('setPodiumViewPreference com userId ausente: nunca escreve, nunca lança', () => {
    expect(() => setPodiumViewPreference(null, 'C')).not.toThrow();
    expect(() => setPodiumViewPreference('', 'C')).not.toThrow();
    expect(window.localStorage.length).toBe(0);
  });
});

describe('isolamento por usuário (§39 do EXEC — nunca uma chave global)', () => {
  it('Kauan usando C e Lucas usando D não se afetam', () => {
    setPodiumViewPreference('kauan', 'C');
    setPodiumViewPreference('lucas', 'D');
    expect(getPodiumViewPreference('kauan')).toBe('C');
    expect(getPodiumViewPreference('lucas')).toBe('D');
  });

  it('Manager usando B não altera a preferência de nenhum outro usuário', () => {
    setPodiumViewPreference('seller-1', 'A');
    setPodiumViewPreference('manager-1', 'B');
    expect(getPodiumViewPreference('seller-1')).toBe('A');
    expect(getPodiumViewPreference('manager-1')).toBe('B');
  });

  it('chaves usadas no localStorage são por usuário, nunca uma chave global única', () => {
    setPodiumViewPreference('user-a', 'A');
    setPodiumViewPreference('user-b', 'B');
    expect(window.localStorage.getItem('kapa-crm:podium-view:user-a')).toBe('A');
    expect(window.localStorage.getItem('kapa-crm:podium-view:user-b')).toBe('B');
  });
});
