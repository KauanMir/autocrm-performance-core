// @vitest-environment node
// Postgres isolado, sem rede: valida o webhook, adapters supabase-js e SQL real.
// O bridge/harness existente simula PostgREST/auth. Conexão única: não prova
// concorrência entre workers nem substitui testes em Supabase local.
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/meta/route';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { sweepMetaLeadgenEvents } from '@/lib/server/meta-webhook/sweep-leadgen-events';
import {
  createPostgrestBridge,
  createWhatsAppTestDatabase as createIsolatedDatabase,
  type WhatsAppTestDatabase as IsolatedDatabase,
} from '../whatsapp/support/pglite-database';

const scheduled = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
vi.mock('@vercel/functions', () => ({
  waitUntil: (job: Promise<unknown>) => { scheduled.jobs.push(job); },
}));

const COMPANY = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const OTHER_COMPANY = 'fb2eeeee-2222-4222-8222-222222222222';
const CONNECTION = 'fb2a0000-0000-4000-8000-000000000001';
const PAGE = '1381033925087695';
const OTHER_PAGE = '940000000000902';
const LEAD = '950000000000901';
const APP_SECRET = 'fake-meta-reliability-secret';
const KEY = 'ab'.repeat(32);
let database: IsolatedDatabase;
let graph: ReturnType<typeof vi.fn<() => Promise<Response>>>;
let failingRpc: string | null;

beforeAll(async () => { database = await createIsolatedDatabase(); }, 240_000);
afterAll(async () => { await database.db.close(); });

beforeEach(async () => {
  // Só no PGlite criado acima; nenhum banco/stack existente é acessado.
  await database.db.exec(`
    truncate public.meta_leadgen_events, public.company_meta_integrations,
      public.leads, public.companies cascade;
    insert into public.companies (id, name, status) values
      ('${COMPANY}', 'TEST COMPANY', 'ativa'),
      ('${OTHER_COMPANY}', 'Outra empresa ficticia', 'ativa');
    insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal)
    values ('${COMPANY}', 'new', 'Novo', 0, false);
  `);
  await database.db.query(`
    insert into public.company_meta_integrations
      (id, company_id, page_id, page_name, access_token_ciphertext,
       token_key_version, granted_scopes, status, connected_at)
    values ($1,$2,$3,'Pagina ficticia',$4,1,
      array['pages_show_list','pages_read_engagement','pages_manage_metadata','leads_retrieval'],
      'connected',now())`, [CONNECTION, COMPANY, PAGE, encryptMetaPageToken({
    plaintextToken: 'fake-page-token-reliability', companyId: COMPANY, pageId: PAGE, key: Buffer.from(KEY, 'hex'),
  })]);

  scheduled.jobs = [];
  failingRpc = null;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://fake.local');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY);
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  vi.stubEnv('META_GRAPH_API_VERSION', 'v26.0');
  graph = vi.fn(async () => new Response(JSON.stringify({ id: LEAD, field_data: [
    { name: 'full_name', values: ['Cliente Ficticio Confiabilidade'] },
    { name: 'phone_number', values: ['+5562900000901'] },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const bridge = createPostgrestBridge(database.db, { failRpc: () => failingRpc });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'graph.facebook.com') return graph();
    if (url.hostname !== 'fake.local') throw new Error('unexpected_network_destination');
    return bridge(input, init);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(scheduled.jobs);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function deliver(page = PAGE) {
  const body = JSON.stringify({ object: 'page', entry: [{ id: page, changes: [{
    field: 'leadgen', value: { page_id: page, leadgen_id: LEAD, form_id: '970000000000901' },
  }] }] });
  const response = await POST(new Request('https://crm.example.test/api/webhooks/meta', {
    method: 'POST', body, headers: {
      'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`,
    },
  }));
  await Promise.all(scheduled.jobs);
  return response;
}

async function event() {
  return (await database.db.query<{
    status: string; attempts: number; last_error_code: string | null; linked: boolean;
  }>('select status, attempts, last_error_code, crm_lead_id is not null as linked from public.meta_leadgen_events')).rows[0];
}

async function counts() {
  return (await database.db.query<{ events: number; leads: number; other_company_leads: number }>(`
    select (select count(*)::int from public.meta_leadgen_events) as events,
      (select count(*)::int from public.leads) as leads,
      (select count(*)::int from public.leads where company_id <> '${COMPANY}') as other_company_leads
  `)).rows[0];
}

describe('contratos SQL de seguranca, idempotencia e recuperacao', () => {
  it('o shim de lives_ok registra uma falha SQL em vez de aprovar silenciosamente', async () => {
    await database.db.exec("truncate tap.results; select public.lives_ok('select 1 / 0', 'falha deliberada do harness')");
    const { rows } = await database.db.query<{ pass: boolean; detail: string }>('select pass, detail from tap.results');
    expect(rows).toHaveLength(1);
    expect(rows[0].pass).toBe(false);
    expect(rows[0].detail).toContain('22012');
  });

  it.each([
    '78_meta_leadgen_events_p1.sql',
    '79_meta_leadgen_processing_p2.sql',
    '80_meta_leadgen_sweep_p25a.sql',
  ])('%s', async (file) => {
    const result = await database.runPgTap(file);
    expect(result.total).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });
});

describe('entrega e recuperacao usando adapters e SQL reais', () => {
  it('cinco entregas sequenciais criam um evento e um lead, sem nova Graph ou tentativa', async () => {
    for (let i = 0; i < 5; i++) expect((await deliver()).status).toBe(200);
    expect(await event()).toEqual({ status: 'processed', attempts: 1, last_error_code: null, linked: true });
    expect(await counts()).toEqual({ events: 1, leads: 1, other_company_leads: 0 });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it('falha transitoria da Graph aguarda backoff e e recuperada pelo sweep', async () => {
    graph.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 2 } }), { status: 503 }));
    expect((await deliver()).status).toBe(200);
    expect(await event()).toMatchObject({ status: 'received', attempts: 1, last_error_code: 'graph_error' });
    expect((await sweepMetaLeadgenEvents()).attempted).toBe(0);
    expect(graph).toHaveBeenCalledTimes(1);
    await database.db.exec("update public.meta_leadgen_events set next_attempt_at = now() - interval '1 second'");
    expect(await sweepMetaLeadgenEvents()).toMatchObject({ attempted: 1, created: 1, infrastructureErrors: 0 });
    expect(await event()).toMatchObject({ status: 'processed', attempts: 2, linked: true, last_error_code: null });
    expect(await counts()).toEqual({ events: 1, leads: 1, other_company_leads: 0 });
  });

  it('falha antes de complete preserva evento e sweep recupera somente apos expirar o lease', async () => {
    failingRpc = 'meta_leadgen_event_complete';
    expect((await deliver()).status).toBe(200);
    expect(await event()).toMatchObject({ status: 'processing', attempts: 1, linked: false });
    expect((await sweepMetaLeadgenEvents()).attempted).toBe(0);
    failingRpc = null;
    await database.db.exec("update public.meta_leadgen_events set locked_until = now() - interval '1 second'");
    expect(await sweepMetaLeadgenEvents()).toMatchObject({ attempted: 1, created: 1 });
    expect(await event()).toMatchObject({ status: 'processed', attempts: 2, linked: true });
    expect(await counts()).toEqual({ events: 1, leads: 1, other_company_leads: 0 });
  });

  it('erro terminal missing_phone nao entra novamente no sweep', async () => {
    graph.mockResolvedValueOnce(new Response(JSON.stringify({ id: LEAD, field_data: [
      { name: 'full_name', values: ['Cliente Sem Telefone'] },
    ] }), { status: 200 }));
    expect((await deliver()).status).toBe(200);
    expect(await event()).toMatchObject({ status: 'failed', last_error_code: 'missing_phone', attempts: 1 });
    expect((await sweepMetaLeadgenEvents()).attempted).toBe(0);
    expect(await counts()).toEqual({ events: 1, leads: 0, other_company_leads: 0 });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it('outra Pagina e ignorada sem consultar a Graph nem gravar evento', async () => {
    expect((await deliver(OTHER_PAGE)).status).toBe(200);
    expect(await counts()).toEqual({ events: 0, leads: 0, other_company_leads: 0 });
    expect(graph).not.toHaveBeenCalled();
  });
});
