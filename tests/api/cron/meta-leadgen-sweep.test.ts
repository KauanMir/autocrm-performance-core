// Rota do sweep: autenticação, flag e respostas. Sweep mockado; nada de banco,
// rede ou Graph.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => ({ sweepMetaLeadgenEvents: vi.fn() }));
vi.mock('@/lib/server/meta-webhook/sweep-leadgen-events', () => sweep);

import { GET } from '@/app/api/cron/meta-leadgen-sweep/route';

const SECRET = 'fake-cron-secret-0123456789-not-real';
const URL_BASE = 'https://crm.example.test/api/cron/meta-leadgen-sweep';

const SUMMARY = {
  attempted: 3,
  created: 1,
  linkedExisting: 1,
  failed: 0,
  leaseLost: 0,
  notClaimed: 0,
  infrastructureErrors: 1,
};

function call(opts: { authorization?: string | null; url?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined && opts.authorization !== null) headers.authorization = opts.authorization;
  return GET(new Request(opts.url ?? URL_BASE, { method: 'GET', headers }));
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  sweep.sweepMetaLeadgenEvents.mockReset().mockResolvedValue({ ...SUMMARY });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('autenticação (falha fechada)', () => {
  it('A. CRON_SECRET ausente no servidor → 401, zero sweep', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(401);
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('A2. CRON_SECRET undefined → 401, zero sweep', async () => {
    vi.stubEnv('CRON_SECRET', undefined as unknown as string);
    const res = await call({ authorization: 'Bearer ' });
    expect(res.status).toBe(401);
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('B. header Authorization ausente → 401, zero sweep', async () => {
    const res = await call({ authorization: null });
    expect(res.status).toBe(401);
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('C. Bearer errado → 401, zero sweep', async () => {
    const res = await call({ authorization: 'Bearer wrong-secret-value' });
    expect(res.status).toBe(401);
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('C2. secret sem prefixo Bearer, ou prefixo em outro caso → 401', async () => {
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect((await call({ authorization: `bearer ${SECRET}` })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('ordem: sem autenticação e com flag OFF → 401 (não revela estado da flag)', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    const res = await call({ authorization: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: 'unauthorized' });
  });
});

describe('flag', () => {
  it('D. Bearer correto + flag OFF → 200 disabled, zero sweep', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'disabled' });
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });

  it('flag com valor diferente de "true" conta como OFF', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'TRUE');
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(await res.json()).toEqual({ status: 'disabled' });
    expect(sweep.sweepMetaLeadgenEvents).not.toHaveBeenCalled();
  });
});

describe('execução', () => {
  it('E. Bearer correto + flag ON → sweep exatamente 1 vez, 200 com contadores', async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(sweep.sweepMetaLeadgenEvents).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ status: 'ok', ...SUMMARY });
  });

  it('F. sweep sem eventos → resposta válida com zeros', async () => {
    sweep.sweepMetaLeadgenEvents.mockResolvedValue({
      attempted: 0,
      created: 0,
      linkedExisting: 0,
      failed: 0,
      leaseLost: 0,
      notClaimed: 0,
      infrastructureErrors: 0,
    });
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', attempted: 0, created: 0 });
  });

  it('G. resposta tem exatamente as chaves permitidas e nenhum ID', async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'status',
        'attempted',
        'created',
        'linkedExisting',
        'failed',
        'leaseLost',
        'notClaimed',
        'infrastructureErrors',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|token|phone|email/i);
  });

  it('I. query string e parâmetros do caller não alteram o sweep', async () => {
    const res = await call({
      authorization: `Bearer ${SECRET}`,
      url: `${URL_BASE}?limit=999&batch=500&eventId=abc&companyId=xyz&timeout=1`,
    });
    expect(res.status).toBe(200);
    expect(sweep.sweepMetaLeadgenEvents).toHaveBeenCalledTimes(1);
    expect(sweep.sweepMetaLeadgenEvents.mock.calls[0]).toEqual([]);
  });
});

describe('erro interno', () => {
  it('H. sweep lança com segredo na mensagem → 500 genérico, segredo ausente', async () => {
    sweep.sweepMetaLeadgenEvents.mockRejectedValue(new Error(`db down, leaked ${SECRET}`));
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ status: 'error' }));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('leaked');
  });
});

describe('segredo e header nunca vazam', () => {
  it('J. Authorization e CRON_SECRET não aparecem em respostas nem em logs', async () => {
    const header = `Bearer ${SECRET}`;
    const ok = await call({ authorization: header });
    const bad = await call({ authorization: 'Bearer wrong' });
    sweep.sweepMetaLeadgenEvents.mockRejectedValue(new Error(`x ${SECRET}`));
    const err = await call({ authorization: header });

    const bodies = [await ok.text(), await bad.text(), await err.text()].join('\n');
    expect(bodies).not.toContain(SECRET);
    expect(bodies).not.toContain('Bearer');

    const logged = [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]
      .map((args) => JSON.stringify(args))
      .join('\n');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('Bearer');
  });
});
