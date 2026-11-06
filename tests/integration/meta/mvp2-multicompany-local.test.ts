// @vitest-environment node
// META-MVP2 — ponta a ponta LOCAL com duas concessionárias fictícias.
// Rotas reais (start, callback, page-selection, webhook, requeue, unrouted-adopt),
// Auth real (signInWithPassword), PostgREST e Postgres reais, cifra real com chave
// fake. Só a Graph é FAKE, e qualquer outro host externo reprova o teste.
// Só roda com META_MVP2_LOCAL=1 e URL local. Cleanup verificado em zero.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { debugTokenResponse } from '@/tests/helpers/metaGraphFakes';

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));

import { createAdminClient } from '@/lib/server/supabase/admin';
import { POST as startRoute } from '@/app/api/integrations/meta/oauth/start/route';
import { GET as callbackRoute } from '@/app/api/integrations/meta/oauth/callback/route';
import { GET as listRoute, POST as selectRoute } from '@/app/api/integrations/meta/oauth/page-selection/route';
import { POST as webhookRoute } from '@/app/api/webhooks/meta/route';
import { POST as requeueRoute } from '@/app/api/integrations/meta/leadgen-review/requeue/route';
import { POST as adoptRoute } from '@/app/api/integrations/meta/leadgen-review/unrouted-adopt/route';
import { BINDING_COOKIE_NAME, PAGE_SELECTION_COOKIE_NAME } from '@/lib/server/meta-oauth/cookie';
import { sweepMetaLeadgenEvents } from '@/lib/server/meta-webhook/sweep-leadgen-events';

const RUN = process.env.META_MVP2_LOCAL === '1';
const CONTAINER = process.env.META_LOCAL_DB_CONTAINER ?? '';
const APP_URL = 'http://127.0.0.1:3000';
const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-mvp2-local-only-000000';
const STATE_SECRET_HEX = 'a1'.repeat(32);
const KEY_HEX = 'cd'.repeat(32);
const PASSWORD = 'Senha-fake-mvp2-local!';
const FORM = '1086000000000911';

const PAGE_A1 = '970000000000911';
const PAGE_A2 = '970000000000912';
const PAGE_B1 = '970000000000921';
const PAGE_ORPHAN = '970000000000931';
const PHONE = '62999990911';

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1'], {
    input: statement,
    encoding: 'utf8',
  }).trim();
}

// ── Graph fake ─────────────────────────────────────────────────────────
const meta = {
  accountsByCode: new Map<string, string[]>(),
  subscribed: [] as string[],
  revokedPages: new Set<string>(),
  // leadgen_id → Página dona e telefone do formulário.
  leads: new Map<string, { pageId: string; phone: string; name: string }>(),
  leadTokensUsed: [] as { leadgenId: string; token: string }[],
  externalCalls: [] as string[],
};
const pageToken = (pageId: string) => `FAKE-PAGE-TOKEN-${pageId}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function graph(url: URL, init?: RequestInit): Response {
  const path = url.pathname.replace(/^\/v[0-9.]+/, '');
  if (path === '/oauth/access_token') {
    if (url.searchParams.get('grant_type') === 'fb_exchange_token') return json({ access_token: `LONG-${url.searchParams.get('fb_exchange_token')}`, expires_in: 5183944 });
    return json({ access_token: `USER-${url.searchParams.get('code')}`, token_type: 'bearer', expires_in: 5183944 });
  }
  if (path === '/me/permissions') {
    return json({ data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'].map((permission) => ({ permission, status: 'granted' })) });
  }
  if (path === '/me/accounts') {
    const code = (url.searchParams.get('access_token') ?? '').replace(/^(LONG-)?USER-/, '');
    const pages = meta.accountsByCode.get(code) ?? [];
    return json({ data: pages.map((id) => ({ id, name: `Página ${id}`, access_token: pageToken(id), tasks: ['ADVERTISE'] })) });
  }
  if (path === '/debug_token') {
    const pageId = (url.searchParams.get('input_token') ?? '').replace('FAKE-PAGE-TOKEN-', '');
    return debugTokenResponse(APP_ID, { profile_id: pageId, is_valid: !meta.revokedPages.has(pageId) });
  }
  if (path.endsWith('/posts')) return json({ data: [] });
  if (path.endsWith('/subscribed_apps')) {
    expect(init?.method).toBe('POST');
    meta.subscribed.push(path.split('/')[1]);
    return json({ success: true });
  }
  const leadgenId = path.slice(1);
  const lead = meta.leads.get(leadgenId);
  if (!lead) return json({ error: { code: 100 } }, 404);
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  meta.leadTokensUsed.push({ leadgenId, token });
  if (meta.revokedPages.has(lead.pageId)) return json({ error: { code: 190 } }, 400);
  return json({
    id: leadgenId,
    created_time: '2026-11-05T12:00:00+0000',
    form_id: FORM,
    field_data: [
      { name: 'full_name', values: [lead.name] },
      { name: 'phone_number', values: [`+55${lead.phone}`] },
    ],
  });
}

// ── identidades ────────────────────────────────────────────────────────
interface Person {
  id: string;
  jwt: string;
  client: SupabaseClient;
}

describe.runIf(RUN)('META-MVP2 — duas concessionárias, ponta a ponta local', () => {
  const suffix = randomBytes(4).toString('hex');
  const admin = () => createAdminClient();
  const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  let companyA = '';
  let companyB = '';
  let integrationA = '';
  let stageNextA = '';
  const people = {} as Record<'superAdmin' | 'managerA' | 'sellerA' | 'managerB' | 'sellerB', Person>;
  const sellerIdA = `mvp2SellerA${suffix}`;
  const sellerIdB = `mvp2SellerB${suffix}`;
  const logs: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalConsole = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };

  async function person(name: string, platformRole: string | null = null): Promise<Person> {
    const email = `mvp2-${name}-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    const id = created.data.user.id;
    const profile = await admin().from('profiles').upsert({ id, name: `MVP2 ${name}`, email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');
    if (platformRole) sql(`update public.profiles set platform_role = '${platformRole}' where id = '${id}';`);
    const session = createClient(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await session.auth.signInWithPassword({ email, password: PASSWORD });
    if (signed.error || !signed.data.session) throw new Error('fixture_login_failed');
    const jwt = signed.data.session.access_token;
    const client = createClient(url(), anon(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    return { id, jwt, client };
  }

  function member(companyId: string, p: Person, role: 'manager' | 'seller', sellerId?: string): void {
    const membership = sql(`insert into public.company_memberships (company_id, profile_id, role, is_active)
      values ('${companyId}', '${p.id}', '${role}', true) returning id;`).split('\n')[0];
    if (sellerId) {
      sql(`insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active)
        values ('${sellerId}', '${companyId}', 'Vendedor ${sellerId}', 'V', '${p.id}', '${membership}', true);`);
    }
  }

  // ── chamadas às rotas reais ────────────────────────────────────────
  async function startOAuth(p: Person, companyId: string): Promise<Response> {
    return startRoute(new Request(`${APP_URL}/api/integrations/meta/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP_URL, Authorization: `Bearer ${p.jwt}` },
      body: JSON.stringify({ company_id: companyId, flow: 'review_ui' }),
    }));
  }

  // Faz start + callback. Devolve o valor do cookie da seleção.
  async function oauth(p: Person, companyId: string, pages: string[]): Promise<{ selectionCookie: string; location: string }> {
    const started = await startOAuth(p, companyId);
    expect(started.status).toBe(200);
    const binding = started.headers.get('set-cookie')?.match(new RegExp(`${BINDING_COOKIE_NAME}=([^;]+)`))?.[1] ?? '';
    const body = await started.json();
    const state = new URL(body.authorizationUrl).searchParams.get('state') as string;
    const code = `code-${randomBytes(6).toString('hex')}`;
    meta.accountsByCode.set(code, pages);
    const res = await callbackRoute(new Request(`${APP_URL}/api/integrations/meta/oauth/callback?code=${code}&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${BINDING_COOKIE_NAME}=${binding}` },
    }));
    expect(res.status === 302 ? 302 : await res.clone().text()).toBe(302);
    const cookies = res.headers.getSetCookie();
    const selection = cookies.find((c) => c.startsWith(`${PAGE_SELECTION_COOKIE_NAME}=`)) ?? '';
    const selectionCookie = selection.split(';')[0].slice(PAGE_SELECTION_COOKIE_NAME.length + 1);
    expect(selectionCookie).not.toBe('');
    return { selectionCookie, location: res.headers.get('location') as string };
  }

  const selectionHeaders = (p: Person, cookie: string) => ({
    Authorization: `Bearer ${p.jwt}`,
    Cookie: `${PAGE_SELECTION_COOKIE_NAME}=${cookie}`,
  });

  async function listPages(p: Person, cookie: string): Promise<Response> {
    return listRoute(new Request(`${APP_URL}/api/integrations/meta/oauth/page-selection`, { headers: selectionHeaders(p, cookie) }));
  }

  async function selectPage(p: Person, cookie: string, pageId: string): Promise<Response> {
    return selectRoute(new Request(`${APP_URL}/api/integrations/meta/oauth/page-selection`, {
      method: 'POST',
      headers: { ...selectionHeaders(p, cookie), 'Content-Type': 'application/json', Origin: APP_URL },
      body: JSON.stringify({ page_id: pageId }),
    }));
  }

  async function webhook(pageId: string, leadgenId: string, phone: string, name = 'Cliente Local'): Promise<number> {
    meta.leads.set(leadgenId, { pageId, phone, name });
    const raw = JSON.stringify({
      object: 'page',
      entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { page_id: pageId, leadgen_id: leadgenId, form_id: FORM, created_time: 1 } }] }],
    });
    const res = await webhookRoute(new Request(`${APP_URL}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` },
      body: raw,
    }));
    await settle();
    return res.status;
  }

  async function settle(): Promise<void> {
    while (pending.length > 0) await Promise.all(pending.splice(0));
  }

  async function adopt(p: Person, companyId: string, pageId: string): Promise<Response> {
    return adoptRoute(new Request(`${APP_URL}/api/integrations/meta/leadgen-review/unrouted-adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP_URL, Authorization: `Bearer ${p.jwt}` },
      body: JSON.stringify({ company_id: companyId, page_id: pageId }),
    }));
  }

  const leadCountBy = (companyId: string, phone: string) =>
    Number(sql(`select count(*) from public.leads where company_id = '${companyId}' and phone_digits in ('${phone}', '55${phone}');`));
  const connectionStatus = (companyId: string, pageId: string) =>
    sql(`select status from public.company_meta_integrations where company_id = '${companyId}' and page_id = '${pageId}';`);
  const unroutedReason = (leadgenId: string) =>
    sql(`select reason from public.meta_leadgen_unrouted_events where leadgen_id = '${leadgenId}' and resolved_at is null;`);
  const unroutedRow = async (companyId: string, pageId: string) =>
    ((await people.superAdmin.client.rpc('meta_leadgen_unrouted_list', { p_company_id: companyId })).data ?? [])
      .find((row: { page_id: string }) => row.page_id === pageId);
  const leadRow = async (p: Person, phone: string) =>
    (await p.client.from('leads').select('id, company_id, seller_id, version, stage_id').in('phone_digits', [phone, `55${phone}`]).maybeSingle()).data;

  beforeAll(async () => {
    if (!/^http:\/\/127\.0\.0\.1:/.test(url() ?? '')) throw new Error('refusing to run: supabase url is not local');
    if (!CONTAINER.includes('sbx')) throw new Error('refusing to run: container is not the disposable sandbox');
    vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
    vi.stubEnv('META_APP_ID', APP_ID);
    vi.stubEnv('META_APP_SECRET', APP_SECRET);
    vi.stubEnv('META_LOGIN_CONFIG_ID', '9876543210');
    vi.stubEnv('META_GRAPH_API_VERSION', 'v26.0');
    vi.stubEnv('APP_URL', APP_URL);
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_HEX);
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');

    // Atribuição direta, não vi.spyOn: tests/setup.ts roda restoreAllMocks depois
    // de cada teste e devolveria o fetch real para o caso seguinte.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.hostname === '127.0.0.1') return originalFetch(input, init);
      if (target.hostname === 'graph.facebook.com') return graph(target, init);
      meta.externalCalls.push(target.hostname);
      throw new Error('external_call_blocked');
    }) as typeof fetch;
    console.log = capture;
    console.error = capture;
    console.warn = capture;

    const a = await admin().from('companies').insert({ name: `MVP2 Concessionária A ${suffix}`, status: 'ativa' }).select('id').single();
    const b = await admin().from('companies').insert({ name: `MVP2 Concessionária B ${suffix}`, status: 'ativa' }).select('id').single();
    if (a.error || b.error || !a.data || !b.data) throw new Error('fixture_company_failed');
    companyA = a.data.id;
    companyB = b.data.id;
    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
      ('${companyA}', 'new', 'Novo', 0, false), ('${companyA}', 'contacted', 'Contato', 1, false),
      ('${companyB}', 'new', 'Novo', 0, false);`);
    stageNextA = sql(`select id from public.pipeline_stages where company_id = '${companyA}' and code = 'contacted';`);

    people.superAdmin = await person('super', 'super_admin');
    people.managerA = await person('manager-a');
    people.sellerA = await person('seller-a');
    people.managerB = await person('manager-b');
    people.sellerB = await person('seller-b');
    member(companyA, people.managerA, 'manager');
    member(companyA, people.sellerA, 'seller', sellerIdA);
    member(companyB, people.managerB, 'manager');
    member(companyB, people.sellerB, 'seller', sellerIdB);
  });

  afterAll(async () => {
    await settle();
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    vi.unstubAllEnvs();
    sql(`delete from public.meta_leadgen_unrouted_events where page_id in ('${PAGE_A1}', '${PAGE_A2}', '${PAGE_B1}', '${PAGE_ORPHAN}');
      delete from public.meta_oauth_page_selections where company_id in ('${companyA}', '${companyB}');
      delete from public.lead_form_submissions where company_id in ('${companyA}', '${companyB}');
      delete from public.meta_leadgen_events where company_id in ('${companyA}', '${companyB}');
      delete from public.lead_timeline_entries where company_id in ('${companyA}', '${companyB}');
      delete from public.leads where company_id in ('${companyA}', '${companyB}');
      delete from public.company_meta_integrations where company_id in ('${companyA}', '${companyB}');
      delete from public.company_meta_lead_ads_access where company_id in ('${companyA}', '${companyB}');
      delete from public.sellers where company_id in ('${companyA}', '${companyB}');
      delete from public.company_memberships where company_id in ('${companyA}', '${companyB}');
      delete from public.pipeline_stages where company_id in ('${companyA}', '${companyB}');
      delete from public.audit_log where company_id in ('${companyA}', '${companyB}');
      delete from public.companies where id in ('${companyA}', '${companyB}');`);
    for (const p of Object.values(people)) await admin().auth.admin.deleteUser(p.id);
    const left = sql(`select (select count(*) from public.companies where id in ('${companyA}', '${companyB}'))
      + (select count(*) from public.meta_leadgen_unrouted_events where page_id in ('${PAGE_A1}', '${PAGE_A2}', '${PAGE_B1}', '${PAGE_ORPHAN}'));`);
    expect(left).toBe('0');
  });

  // ═══ habilitação ═══════════════════════════════════════════════════
  it('A1. empresa nasce desabilitada: Manager não inicia a conexão e não se habilita', async () => {
    expect((await startOAuth(people.managerA, companyA)).status).toBe(403);
    const { error } = await people.managerA.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyA, p_enabled: true });
    expect(error?.message).toBe('forbidden');
  });

  it('A2. Seller nunca lê nem altera a habilitação', async () => {
    expect((await people.sellerA.client.rpc('meta_lead_ads_company_access', { p_company_id: companyA })).error?.message).toBe('forbidden');
    expect((await people.sellerA.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyA, p_enabled: true })).error?.message).toBe('forbidden');
  });

  it('A3. Super Admin habilita só a empresa escolhida', async () => {
    const { data } = await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyA, p_enabled: true });
    expect(data?.[0]?.enabled).toBe(true);
    expect((await people.managerB.client.rpc('meta_lead_ads_company_access', { p_company_id: companyB })).data?.[0]?.enabled).toBe(false);
    expect((await startOAuth(people.managerB, companyB)).status).toBe(403);
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: true });
  });

  it('A4. Seller e Manager de outra empresa não iniciam OAuth', async () => {
    expect((await startOAuth(people.sellerA, companyA)).status).toBe(403);
    expect((await startOAuth(people.managerB, companyA)).status).toBe(403);
  });

  it('A5. empresa fora de `ativa` não é habilitada: lead nela ficaria invisível para todos', async () => {
    sql(`update public.companies set status = 'implantacao' where id = '${companyB}';`);
    const refused = await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: true });
    expect(refused.error?.message).toBe('company_not_active');
    // Habilitação já marcada não vale enquanto a empresa não está ativa.
    expect((await people.managerB.client.rpc('meta_lead_ads_company_access', { p_company_id: companyB })).data?.[0]?.enabled).toBe(false);
    expect((await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: false })).error).toBeNull();
    sql(`update public.companies set status = 'ativa' where id = '${companyB}';`);
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: true });
  });

  // ═══ conexão ═══════════════════════════════════════════════════════
  it('B1. Manager A vê as Páginas autorizadas e conecta só a escolhida', async () => {
    const { selectionCookie, location } = await oauth(people.managerA, companyA, [PAGE_A1, PAGE_A2]);
    expect(location).toBe(`${APP_URL}/company/${companyA}?meta_select=1`);

    const listed = await listPages(people.managerA, selectionCookie);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.pages.map((p: { pageId: string }) => p.pageId).sort()).toEqual([PAGE_A1, PAGE_A2]);
    expect(JSON.stringify(body)).not.toContain('FAKE-PAGE-TOKEN');

    const connected = await selectPage(people.managerA, selectionCookie, PAGE_A1);
    expect(connected.status).toBe(200);
    expect(meta.subscribed).toEqual([PAGE_A1]);
    expect(connectionStatus(companyA, PAGE_A1)).toBe('connected');
    expect(connectionStatus(companyA, PAGE_A2)).toBe('');
    integrationA = sql(`select id from public.company_meta_integrations where company_id = '${companyA}' and page_id = '${PAGE_A1}';`);
    // Nenhum ciphertext sobrevive ao consumo.
    expect(sql(`select count(*) from public.meta_oauth_page_selections where company_id = '${companyA}' and pages::text like '%v1.%';`)).toBe('0');
  });

  it('B2. Manager B conecta a própria Página na própria empresa', async () => {
    const { selectionCookie } = await oauth(people.managerB, companyB, [PAGE_B1]);
    expect((await selectPage(people.managerB, selectionCookie, PAGE_B1)).status).toBe(200);
    expect(connectionStatus(companyB, PAGE_B1)).toBe('connected');
  });

  it('B3. replay: a mesma seleção não conecta de novo nem inscreve de novo', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A1, PAGE_A2]);
    expect((await selectPage(people.managerA, selectionCookie, PAGE_A1)).status).toBe(200);
    const subscribed = meta.subscribed.length;
    const replay = await selectPage(people.managerA, selectionCookie, PAGE_A2);
    expect(replay.status).toBe(410);
    expect(await replay.json()).toEqual({ ok: false, error: 'selection_already_used' });
    expect(meta.subscribed.length).toBe(subscribed);
    expect(connectionStatus(companyA, PAGE_A2)).toBe('');
  });

  it('B4. concorrência: duas confirmações simultâneas conectam uma vez só', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A1]);
    const subscribed = meta.subscribed.length;
    const statuses = (await Promise.all([1, 2, 3].map(() => selectPage(people.managerA, selectionCookie, PAGE_A1)))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 410, 410]);
    expect(meta.subscribed.length).toBe(subscribed + 1);
    expect(sql(`select count(*) from public.company_meta_integrations where page_id = '${PAGE_A1}';`)).toBe('1');
  });

  it('B5. a seleção é de quem iniciou: Manager de outra empresa, Seller e Super Admin não a usam', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A2]);
    for (const other of [people.managerB, people.sellerA, people.superAdmin]) {
      expect((await listPages(other, selectionCookie)).status).toBe(403);
      expect((await selectPage(other, selectionCookie, PAGE_A2)).status).toBe(403);
    }
    expect(connectionStatus(companyA, PAGE_A2)).toBe('');
    // A seleção segue intacta para o dono legítimo.
    expect((await listPages(people.managerA, selectionCookie)).status).toBe(200);
  });

  it('B6. Página fora da lista autorizada é recusada e a seleção continua válida', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A1]);
    const refused = await selectPage(people.managerA, selectionCookie, PAGE_B1);
    expect(await refused.json()).toEqual({ ok: false, error: 'page_not_offered' });
    expect(refused.status).toBe(409);
    expect(connectionStatus(companyA, PAGE_B1)).toBe('');
    expect((await listPages(people.managerA, selectionCookie)).status).toBe(200);
  });

  it('B7. Página já conectada a outra empresa é recusada antes de consumir', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_B1, PAGE_A2]);
    const subscribed = meta.subscribed.length;
    expect((await selectPage(people.managerA, selectionCookie, PAGE_B1)).status).toBe(409);
    expect(meta.subscribed.length).toBe(subscribed);
    expect((await listPages(people.managerA, selectionCookie)).status).toBe(200);
  });

  it('B8. seleção vencida no banco não lista nem conecta', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A2]);
    sql(`update public.meta_oauth_page_selections set expires_at = created_at - interval '1 second', created_at = created_at - interval '1 minute'
      where company_id = '${companyA}' and profile_id = '${people.managerA.id}';`);
    expect((await listPages(people.managerA, selectionCookie)).status).toBe(410);
    const subscribed = meta.subscribed.length;
    const expired = await selectPage(people.managerA, selectionCookie, PAGE_A2);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ ok: false, error: 'selection_expired' });
    expect(meta.subscribed.length).toBe(subscribed);
    expect(sql(`select count(*) from public.meta_oauth_page_selections where company_id = '${companyA}' and profile_id = '${people.managerA.id}' and expires_at <= now();`)).toBe('0');
  });

  it('B9. empresa desligada depois do OAuth bloqueia a conexão', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A2]);
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyA, p_enabled: false });
    expect((await selectPage(people.managerA, selectionCookie, PAGE_A2)).status).toBe(403);
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyA, p_enabled: true });
    expect(connectionStatus(companyA, PAGE_A2)).toBe('');
  });

  it('B10. token de Página inválido na Meta nunca vira conexão nem inscrição', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A2]);
    meta.revokedPages.add(PAGE_A2);
    const subscribed = meta.subscribed.length;
    const refused = await selectPage(people.managerA, selectionCookie, PAGE_A2);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ ok: false, error: 'page_token_invalid' });
    expect(meta.subscribed.length).toBe(subscribed);
    expect(connectionStatus(companyA, PAGE_A2)).toBe('');
    meta.revokedPages.delete(PAGE_A2);
  });

  // ═══ leads na empresa certa ════════════════════════════════════════
  it('C1. mesmo telefone em Páginas diferentes vira um lead em cada empresa, sem cruzar', async () => {
    expect(await webhook(PAGE_A1, '988000000000911', PHONE, 'Cliente da A')).toBe(200);
    expect(await webhook(PAGE_B1, '988000000000921', PHONE, 'Cliente da B')).toBe(200);
    expect(leadCountBy(companyA, PHONE)).toBe(1);
    expect(leadCountBy(companyB, PHONE)).toBe(1);
    expect(sql(`select name from public.leads where company_id = '${companyA}' and phone_digits like '%${PHONE}';`)).toBe('Cliente da A');
    expect(sql(`select name from public.leads where company_id = '${companyB}' and phone_digits like '%${PHONE}';`)).toBe('Cliente da B');
  });

  it('C2. cada lead foi buscado com o token da própria Página', () => {
    expect(meta.leadTokensUsed).toEqual([
      { leadgenId: '988000000000911', token: pageToken(PAGE_A1) },
      { leadgenId: '988000000000921', token: pageToken(PAGE_B1) },
    ]);
  });

  it('C3. payload forjado com empresa não muda o destino: vale a conexão da Página', async () => {
    const raw = JSON.stringify({ object: 'page', company_id: companyB, entry: [{ id: PAGE_A1, changes: [{ field: 'leadgen', value: { page_id: PAGE_A1, leadgen_id: '988000000000912', form_id: FORM, company_id: companyB } }] }] });
    meta.leads.set('988000000000912', { pageId: PAGE_A1, phone: '62999990912', name: 'Forjado' });
    const res = await webhookRoute(new Request(`${APP_URL}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` },
      body: raw,
    }));
    await settle();
    expect(res.status).toBe(200);
    expect(leadCountBy(companyA, '62999990912')).toBe(1);
    expect(leadCountBy(companyB, '62999990912')).toBe(0);
  });

  it('C4. entrega repetida não duplica o lead', async () => {
    expect(await webhook(PAGE_A1, '988000000000911', PHONE, 'Cliente da A')).toBe(200);
    expect(leadCountBy(companyA, PHONE)).toBe(1);
  });

  it('C5. assinatura inválida é recusada e não registra nada', async () => {
    const raw = JSON.stringify({ object: 'page', entry: [{ id: PAGE_A1, changes: [{ field: 'leadgen', value: { page_id: PAGE_A1, leadgen_id: '988000000000999' } }] }] });
    const res = await webhookRoute(new Request(`${APP_URL}/api/webhooks/meta`, {
      method: 'POST', headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }, body: raw,
    }));
    expect(res.status).toBe(403);
    expect(sql(`select count(*) from public.meta_leadgen_events where leadgen_id = '988000000000999';`)).toBe('0');
    expect(sql(`select count(*) from public.meta_leadgen_unrouted_events where leadgen_id = '988000000000999';`)).toBe('0');
  });

  // ═══ fila "Sem vendedor" e atribuição, com sessões reais ═══════════
  it('D1. lead novo fica na fila do Manager e invisível para os Sellers', async () => {
    const lead = await leadRow(people.managerA, PHONE);
    expect(lead?.seller_id).toBeNull();
    expect(lead?.company_id).toBe(companyA);
    expect(await leadRow(people.sellerA, PHONE)).toBeNull();
    expect((await people.managerB.client.from('leads').select('id').eq('id', lead?.id as string)).data).toEqual([]);
    expect((await people.sellerB.client.from('leads').select('id').eq('id', lead?.id as string)).data).toEqual([]);
  });

  const assign = (p: Person, leadId: string, sellerId: string, version: number) =>
    p.client.rpc('assign_lead_seller', { p_lead_id: leadId, p_seller_id: sellerId, p_expected_version: version });

  it('D2. atribuições indevidas falham e o lead continua na fila', async () => {
    const lead = (await leadRow(people.managerA, PHONE)) as NonNullable<Awaited<ReturnType<typeof leadRow>>>;
    expect((await assign(people.sellerA, lead.id, sellerIdA, lead.version)).error?.message).toBe('forbidden');
    expect((await assign(people.managerA, lead.id, sellerIdB, lead.version)).error?.message).toBe('seller_not_found');
    expect((await assign(people.managerB, lead.id, sellerIdB, lead.version)).error?.message).toBe('lead_not_found');
    const after = await leadRow(people.managerA, PHONE);
    expect(after?.seller_id).toBeNull();
    expect(after?.version).toBe(lead.version);
  });

  it('D3. atribuição concorrente: uma vence, a outra recebe stale_write, sem corromper', async () => {
    const lead = (await leadRow(people.managerA, PHONE)) as NonNullable<Awaited<ReturnType<typeof leadRow>>>;
    const replies = await Promise.all([assign(people.managerA, lead.id, sellerIdA, lead.version), assign(people.managerA, lead.id, sellerIdA, lead.version)]);
    const failures = replies.filter((r) => r.error);
    expect(failures).toHaveLength(1);
    expect(failures[0].error?.message).toBe('stale_write');
    const after = await leadRow(people.managerA, PHONE);
    expect(after?.seller_id).toBe(sellerIdA);
    expect(after?.version).toBe(lead.version + 1);
    expect(sql(`select count(*) from public.lead_timeline_entries where lead_id = '${lead.id}' and label = 'Responsável alterado';`)).toBe('1');
  });

  it('D4. Seller atribuído vê o lead, avança o funil e o histórico registra tudo', async () => {
    const seen = await leadRow(people.sellerA, PHONE);
    expect(seen?.seller_id).toBe(sellerIdA);
    expect((await leadRow(people.sellerB, PHONE))).toBeNull();
    const moved = await people.sellerA.client.rpc('move_lead_to_stage', { p_lead_id: seen?.id as string, p_stage_id: stageNextA });
    expect(moved.error).toBeNull();
    expect((await leadRow(people.managerA, PHONE))?.stage_id).toBe(stageNextA);
    const timeline = (await people.managerA.client.from('lead_timeline_entries').select('label, detail').eq('lead_id', seen?.id as string)).data ?? [];
    expect(timeline.some((t) => t.label === 'Responsável alterado')).toBe(true);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect((await people.sellerA.client.rpc('list_lead_form_submissions', { p_lead_id: seen?.id as string })).data).toHaveLength(1);
  });

  it('D5. lead da empresa B segue intacto: sem vendedor e na etapa inicial', async () => {
    const leadB = await leadRow(people.managerB, PHONE);
    expect(leadB?.seller_id).toBeNull();
    expect(leadB?.company_id).toBe(companyB);
  });

  // ═══ token inválido e posse da Página ══════════════════════════════
  it('E1. token revogado: conexão em erro, evento visível na fila, nenhum lead', async () => {
    meta.revokedPages.add(PAGE_A1);
    expect(await webhook(PAGE_A1, '988000000000913', '62999990913')).toBe(200);
    expect(connectionStatus(companyA, PAGE_A1)).toBe('error');
    expect(leadCountBy(companyA, '62999990913')).toBe(0);
    const review = await people.managerA.client.rpc('meta_leadgen_review_list', { p_company_id: companyA });
    expect((review.data ?? []).map((r: { last_error_code: string }) => r.last_error_code)).toContain('token_invalid');
  });

  it('E2. conexão em erro continua da dona: outra empresa não toma a Página', async () => {
    meta.revokedPages.delete(PAGE_A1);
    const { selectionCookie } = await oauth(people.managerB, companyB, [PAGE_A1]);
    const subscribed = meta.subscribed.length;
    const taken = await selectPage(people.managerB, selectionCookie, PAGE_A1);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ ok: false, error: 'page_already_connected' });
    expect(meta.subscribed.length).toBe(subscribed);
    expect(connectionStatus(companyB, PAGE_A1)).toBe('');
    expect(connectionStatus(companyA, PAGE_A1)).toBe('error');
  });

  it('E3. mesmo sem passar pela rota, o banco recusa a tomada da Página em erro', () => {
    const attempt = () => sql(`set role service_role; select id from public.meta_connection_upsert_v2(
      '${companyB}', '${PAGE_A1}', 'Tomada', 'v1.fake', 1::smallint,
      array['pages_show_list','pages_read_engagement','pages_manage_metadata','leads_retrieval'],
      now(), null, now(), 'exchanged_long_lived', now());`);
    expect(attempt).toThrow(/page_already_connected/);
  });

  it('E4. evento recebido com a conexão em erro fica com a dona e sai após reconectar', async () => {
    expect(await webhook(PAGE_A1, '988000000000914', '62999990914')).toBe(200);
    expect(sql(`select company_id from public.meta_leadgen_events where leadgen_id = '988000000000914';`)).toBe(companyA);

    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_A1]);
    expect((await selectPage(people.managerA, selectionCookie, PAGE_A1)).status).toBe(200);
    expect(connectionStatus(companyA, PAGE_A1)).toBe('connected');

    const events = (await people.managerA.client.rpc('meta_leadgen_review_list', { p_company_id: companyA })).data ?? [];
    for (const event of events as { event_id: string }[]) {
      const res = await requeueRoute(new Request(`${APP_URL}/api/integrations/meta/leadgen-review/requeue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: APP_URL, Authorization: `Bearer ${people.managerA.jwt}` },
        body: JSON.stringify({ company_id: companyA, event_id: event.event_id }),
      }));
      expect(res.status).toBe(200);
    }
    await settle();
    await sweepMetaLeadgenEvents({ limit: 20 });
    expect(leadCountBy(companyA, '62999990913')).toBe(1);
    expect(leadCountBy(companyA, '62999990914')).toBe(1);
    expect(leadCountBy(companyB, '62999990913')).toBe(0);
  });

  it('E5. Manager de outra empresa não reprocessa evento alheio', async () => {
    const eventId = sql(`select id from public.meta_leadgen_events where company_id = '${companyA}' limit 1;`);
    const res = await requeueRoute(new Request(`${APP_URL}/api/integrations/meta/leadgen-review/requeue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP_URL, Authorization: `Bearer ${people.managerB.jwt}` },
      body: JSON.stringify({ company_id: companyA, event_id: eventId }),
    }));
    expect(res.status).toBe(403);
  });

  // ═══ empresa desabilitada e Página sem conexão ═════════════════════
  it('F1. empresa desabilitada: nenhum lead, evento retido sem empresa', async () => {
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: false });
    expect(await webhook(PAGE_B1, '988000000000922', '62999990922')).toBe(200);
    expect(leadCountBy(companyB, '62999990922')).toBe(0);
    expect(unroutedReason('988000000000922')).toBe('company_disabled');
    expect(sql(`select count(*) from public.meta_leadgen_events where leadgen_id = '988000000000922';`)).toBe('0');
  });

  it('F1b. empresa suspensa: evento retido em vez de criar lead invisível', async () => {
    sql(`update public.companies set status = 'suspensa' where id = '${companyA}';`);
    expect(await webhook(PAGE_A1, '988000000000915', '62999990915')).toBe(200);
    sql(`update public.companies set status = 'ativa' where id = '${companyA}';`);
    expect(leadCountBy(companyA, '62999990915')).toBe(0);
    expect(unroutedReason('988000000000915')).toBe('company_disabled');
    expect(await (await adopt(people.superAdmin, companyA, PAGE_A1)).json()).toMatchObject({ outcome: 'adopted', adopted: 1 });
    await settle();
    expect(leadCountBy(companyA, '62999990915')).toBe(1);
  });

  it('F2. reentrega do evento retido não duplica e conta a tentativa', async () => {
    expect(await webhook(PAGE_B1, '988000000000922', '62999990922')).toBe(200);
    expect(sql(`select delivery_count from public.meta_leadgen_unrouted_events where leadgen_id = '988000000000922';`)).toBe('2');
  });

  it('F3. eventos retidos: só o Super Admin lê e libera', async () => {
    for (const other of [people.managerB, people.sellerB, people.managerA]) {
      expect((await other.client.rpc('meta_leadgen_unrouted_list', { p_company_id: companyB })).error?.message).toBe('forbidden');
      expect((await adopt(other, companyB, PAGE_B1)).status).toBe(403);
    }
    expect(await unroutedRow(companyB, PAGE_B1)).toEqual(expect.objectContaining({ page_id: PAGE_B1, reason: 'company_disabled', pending: 1, can_adopt: false }));
  });

  it('F4. liberar com a empresa desligada é recusado; habilitada, o lead entra só nela', async () => {
    expect(await (await adopt(people.superAdmin, companyB, PAGE_B1)).json()).toMatchObject({ ok: true, outcome: 'company_disabled', adopted: 0 });
    await people.superAdmin.client.rpc('meta_lead_ads_set_company_access', { p_company_id: companyB, p_enabled: true });
    expect((await unroutedRow(companyB, PAGE_B1))?.can_adopt).toBe(true);

    const res = await adopt(people.superAdmin, companyB, PAGE_B1);
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'adopted', adopted: 1, processingScheduled: true });
    await settle();
    expect(leadCountBy(companyB, '62999990922')).toBe(1);
    expect(leadCountBy(companyA, '62999990922')).toBe(0);
    expect(unroutedReason('988000000000922')).toBe('');
    expect(sql(`select count(*) from public.audit_log where action = 'meta_leadgen_unrouted_adopted' and company_id = '${companyB}';`)).toBe('1');
  });

  it('F5. liberar duas vezes não repete nada', async () => {
    expect(await (await adopt(people.superAdmin, companyB, PAGE_B1)).json()).toMatchObject({ outcome: 'nothing_pending', adopted: 0 });
    expect(leadCountBy(companyB, '62999990922')).toBe(1);
  });

  it('F6. Página inscrita sem conexão: evento retido e nenhuma empresa recebe', async () => {
    const before = sql(`select count(*) from public.leads where company_id in ('${companyA}', '${companyB}');`);
    expect(await webhook(PAGE_ORPHAN, '988000000000931', '62999990931')).toBe(200);
    expect(unroutedReason('988000000000931')).toBe('no_connection');
    expect(sql(`select count(*) from public.leads where company_id in ('${companyA}', '${companyB}');`)).toBe(before);
  });

  it('F7. Super Admin não libera Página órfã para empresa que não a conectou', async () => {
    expect(await (await adopt(people.superAdmin, companyA, PAGE_ORPHAN)).json()).toMatchObject({ outcome: 'not_connected', adopted: 0 });
    expect((await unroutedRow(companyA, PAGE_ORPHAN))?.can_adopt).toBe(false);
  });

  it('F8. depois que a empresa conecta a Página, a liberação entrega o lead a ela', async () => {
    const { selectionCookie } = await oauth(people.managerA, companyA, [PAGE_ORPHAN]);
    expect((await selectPage(people.managerA, selectionCookie, PAGE_ORPHAN)).status).toBe(200);
    expect(leadCountBy(companyA, '62999990931')).toBe(0);
    expect(await (await adopt(people.superAdmin, companyA, PAGE_ORPHAN)).json()).toMatchObject({ outcome: 'adopted', adopted: 1 });
    await settle();
    expect(leadCountBy(companyA, '62999990931')).toBe(1);
    expect(leadCountBy(companyB, '62999990931')).toBe(0);
  });

  it('F9. evento liberado passa pela mesma chave única: nunca duplica', () => {
    expect(sql(`select count(*) from public.meta_leadgen_events where leadgen_id = '988000000000931';`)).toBe('1');
  });

  // ═══ garantias transversais ════════════════════════════════════════
  it('G1. isolamento geral: nenhum lead de Página da A foi parar na B, e vice-versa', () => {
    expect(sql(`select count(*) from public.meta_leadgen_events e join public.company_meta_integrations i on i.id = e.integration_id
      where e.company_id <> i.company_id or e.page_id <> i.page_id;`)).toBe('0');
    expect(sql(`select count(*) from public.meta_leadgen_events e join public.leads l on l.id = e.crm_lead_id where e.company_id <> l.company_id;`)).toBe('0');
    expect(integrationA).not.toBe('');
  });

  it('G2. nenhuma chamada saiu para host fora do Supabase local e da Graph fake', () => {
    expect(meta.externalCalls).toEqual([]);
  });

  it('G3. nenhum token, segredo ou ciphertext apareceu nos logs', () => {
    const all = logs.join('\n');
    for (const secret of ['FAKE-PAGE-TOKEN', 'USER-code-', APP_SECRET, STATE_SECRET_HEX, KEY_HEX, 'v1.']) expect(all).not.toContain(secret);
  });
});
