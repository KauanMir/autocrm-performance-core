// Regressão (produção, 2026-11-13): no Next 14 os fetch do supabase-js na rota do cron eram servidos pelo
// Data Cache ("Using cache") e o ciclo nunca via o vínculo recém-ligado. A rota precisa declarar
// fetchCache = 'force-no-store'. Lido do arquivo para não carregar o cliente Supabase no teste.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'app/api/cron/kapa-leads-sync/route.ts'), 'utf8');

describe('kapa-leads-sync cron route segment config', () => {
  it('never serves fetch from the Next data cache', () => {
    expect(source).toMatch(/^export const fetchCache = 'force-no-store';$/m);
  });

  it('stays dynamic on the Node.js runtime', () => {
    expect(source).toMatch(/^export const dynamic = 'force-dynamic';$/m);
    expect(source).toMatch(/^export const runtime = 'nodejs';$/m);
  });
});
