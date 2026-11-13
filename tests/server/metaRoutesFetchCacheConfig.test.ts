// Regressão (produção, 2026-11-13): no Next 14 os fetch do supabase-js eram servidos pelo Data Cache ("Using cache")
// mesmo com dynamic = 'force-dynamic'. No sweep do Meta isso fazia o claim_batch/purge nunca chegarem ao banco:
// retentativas e leases vencidos só andavam quando chegava um webhook novo. Toda rota do Meta precisa declarar
// fetchCache = 'force-no-store'. Lido do arquivo para não carregar os módulos server-only no teste.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = [
  'app/api/cron/meta-leadgen-sweep/route.ts',
  'app/api/webhooks/meta/route.ts',
  'app/api/integrations/meta/diagnostics/route.ts',
  'app/api/integrations/meta/oauth/callback/route.ts',
  'app/api/integrations/meta/oauth/page-selection/route.ts',
  'app/api/integrations/meta/oauth/review-status/route.ts',
];

describe.each(ROUTES)('%s segment config', (route) => {
  const source = readFileSync(join(process.cwd(), route), 'utf8');

  it('never serves fetch from the Next data cache', () => {
    expect(source).toMatch(/^export const fetchCache = 'force-no-store';$/m);
  });

  it('stays dynamic on the Node.js runtime', () => {
    expect(source).toMatch(/^export const dynamic = 'force-dynamic';$/m);
    expect(source).toMatch(/^export const runtime = 'nodejs';$/m);
  });
});
