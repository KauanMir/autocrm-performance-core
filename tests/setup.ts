// tests/setup.ts — setup global mínimo (commit 2).
// Sem mocks globais de fetch, Supabase ou localStorage: cada teste declara o
// que precisa. Imports explícitos do Vitest — globals desativados de propósito.
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Bloqueio de rede (tests/helpers/network-guard.cjs). Sem ele, nenhum teste roda: um
// worker iniciado de outra forma não pode alcançar a rede sem ninguém perceber.
const networkGuard = (globalThis as unknown as Record<symbol, { assertClean: (context: string) => void } | undefined>)[
  Symbol.for('kapa.test.networkGuard')
];
if (!networkGuard) throw new Error('Bloqueio de rede ausente: rode os testes pelo vitest.config.ts do projeto.');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Reprova mesmo quando o código engoliu o erro de rede.
  networkGuard.assertClean(expect.getState().currentTestName ?? 'teste');
});

// Tentativa feita depois do fim do último teste do arquivo.
afterAll(() => {
  networkGuard.assertClean(expect.getState().testPath ?? 'arquivo de teste');
});
