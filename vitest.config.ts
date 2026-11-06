// vitest.config.ts — infraestrutura de testes do M1-D (commit 2).
// Sem cobertura ainda, sem globals, sem .env.local: os testes não fazem rede
// e não dependem de variáveis reais do Supabase.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Compatível com ESM/Windows — nenhum caminho absoluto da máquina.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
// Bloqueio de rede: entra em cada worker antes de qualquer código de teste.
// tests/setup.ts recusa rodar sem ele. Ver docs/TESTES-REDE-BLOQUEADA.md.
const networkGuardPreload = fileURLToPath(new URL('./tests/helpers/network-guard.preload.cjs', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  test: {
    environment: 'jsdom',
    pool: 'forks',
    execArgv: ['--require', networkGuardPreload],
    globalSetup: ['./tests/helpers/network-guard.global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    clearMocks: true,
  },
});
