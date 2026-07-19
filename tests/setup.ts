// tests/setup.ts — setup global mínimo (commit 2).
// Sem mocks globais de fetch, Supabase ou localStorage: cada teste declara o
// que precisa. Imports explícitos do Vitest — globals desativados de propósito.
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
