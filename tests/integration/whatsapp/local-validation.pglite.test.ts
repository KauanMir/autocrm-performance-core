// @vitest-environment node
// tests/integration/whatsapp/local-validation.pglite.test.ts — garante que o validador
// para Supabase local funciona antes de existir um Supabase local. Em PGlite as
// requisições rodam em série: este teste prova a lógica do script, NÃO a concorrência.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseUrl,
  runLocalCaptureValidation,
  signLocalJwt,
} from '@/scripts/whatsapp/local-validation/validate-capture-local-core';
import { createPostgrestBridge, createWhatsAppTestDatabase, type WhatsAppTestDatabase } from './support/pglite-database';

let database: WhatsAppTestDatabase;

beforeAll(async () => {
  database = await createWhatsAppTestDatabase();
  await database.db.exec(readFileSync(resolve(process.cwd(), 'scripts/whatsapp/local-validation/fixture.sql'), 'utf8'));
}, 240_000);

afterAll(async () => {
  await database.db.close();
});

describe('trava de ambiente', () => {
  it.each(['http://127.0.0.1:55521', 'http://localhost:54321', 'http://[::1]:54321'])('aceita %s', (url) => {
    expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
  });

  it.each([
    'https://qglirrsyhdfbgkmchwcw.supabase.co',
    'https://crm.assessoriakapa.com.br',
    'http://127.0.0.1.example.com',
    'http://localhost.evil.test',
    'nao-e-url',
  ])('recusa %s', (url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(/local_url/);
  });

  it('o script recusa produção antes de qualquer requisição', async () => {
    let calls = 0;
    await expect(runLocalCaptureValidation(
      { url: 'https://qglirrsyhdfbgkmchwcw.supabase.co', serviceRoleKey: 'x', anonKey: 'y', jwtSecret: 'z', parallelism: 2 },
      (async () => {
        calls += 1;
        return new Response('[]');
      }) as typeof fetch,
    )).rejects.toThrow('local_url_required');
    expect(calls).toBe(0);
  });
});

describe('verificações do validador', () => {
  it('todas passam contra as RPCs reais', async () => {
    const secret = 'fake-local-jwt-secret';
    const results = await runLocalCaptureValidation(
      {
        url: 'http://127.0.0.1:55521',
        serviceRoleKey: signLocalJwt({ sub: 'service', role: 'service_role' }, secret),
        anonKey: signLocalJwt({ sub: 'anon', role: 'anon' }, secret),
        jwtSecret: secret,
        parallelism: 4,
      },
      createPostgrestBridge(database.db),
    );
    expect(results.filter(({ pass }) => !pass)).toEqual([]);
    expect(results.length).toBe(9);
  }, 60_000);
});
