// @vitest-environment node
// KAPA LEADS → CRM — ponta a ponta LOCAL e ISOLADO, com dados fictícios.
//
//   "Landing page" (fetch com Origin) → KAPA Leads REAL (next start, banco local descartável)
//   → exportação assinada → rota cron REAL do CRM → fila → lead no CRM (banco local descartável)
//
// Só roda com KAPA_LEADS_E2E_LOCAL=1, com os dois bancos comprovadamente locais (contêineres
// supabase_db_kapa-*) e o KAPA Leads em 127.0.0.1. Nenhum host externo é aceito pelo guard
// de rede. Orquestração: scratchpad/e2e/run-e2e.mjs (fora do repositório).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDisposableLocalDatabase } from '@/tests/helpers/localDatabaseGuard';
import { GET as syncRoute } from '@/app/api/cron/kapa-leads-sync/route';

const RUN = process.env.KAPA_LEADS_E2E_LOCAL === '1';
const CRM_CONTAINER = process.env.META_LOCAL_DB_CONTAINER ?? '';
const KL_CONTAINER = process.env.KL_E2E_DB_CONTAINER ?? '';
const KL_URL = process.env.KAPA_LEADS_API_URL ?? '';
const LP_ORIGIN = 'http://127.0.0.1:3902';
const STORE_A = 'e2e00000-0000-4000-8000-00000000000a';
const KEY_A = 'camp_pk_e2etestaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'camp_pk_e2etestbbbbbbbbbbbbbbbbbbbbbbbbb';
const PASSWORD = 'Senha-fake-kl-e2e-local!';
const SETTLE_MS = 62_000;

const run = randomUUID().slice(0, 8);
const digitsFromRun = String(parseInt(run, 16)).padStart(8, '0').slice(-7);
const PHONE_1 = `629${digitsFromRun}1`.slice(0, 11);
const PHONE_2 = `629${digitsFromRun}2`.slice(0, 11);
const PHONE_3 = `629${digitsFromRun}3`.slice(0, 11);

function psql(container: string, statement: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1'], {
    input: statement,
    encoding: 'utf8',
  }).trim();
}
const crmSql = (s: string) => psql(CRM_CONTAINER, s);
const klSql = (s: string) => psql(KL_CONTAINER, s);

/** CPF fictício válido (dígitos verificadores corretos), diferente a cada chamada. */
function fakeCpf(): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (new Set(base).size === 1) continue;
    const dv = (digits: number[]) => {
      const sum = digits.reduce((acc, d, i) => acc + d * (digits.length + 1 - i), 0);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    const d1 = dv(base);
    const d2 = dv([...base, d1]);
    return [...base, d1, d2].join('');
  }
}

async function lpSubmit(campaignKey: string, opts: { phone: string; name: string; submissionId?: string; cpf?: string; formData?: Record<string, unknown> }) {
  const submissionId = opts.submissionId ?? randomUUID();
  const response = await fetch(`${KL_URL}/api/public/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: LP_ORIGIN },
    body: JSON.stringify({
      campaignKey,
      clientSubmissionId: submissionId,
      lead: { name: opts.name, cpf: opts.cpf ?? fakeCpf(), birthDate: '1990-05-20', phone: opts.phone, email: null },
      formData: opts.formData ?? { hasTradeIn: true, hasDownPayment: false, hasDriversLicense: true },
      tracking: { utmSource: 'instagram', utmMedium: 'cpc', utmCampaign: `e2e-${run}`, utmContent: null, utmTerm: null, pageUrl: `${LP_ORIGIN}/?utm_source=instagram`, referrer: null },
      consent: { accepted: true, version: '2026-10-v1' },
      website: '',
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown>, submissionId };
}

async function cron() {
  const response = await syncRoute(new Request('http://127.0.0.1/api/cron/kapa-leads-sync', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Impressão digital dos leads da loja no KAPA Leads (para provar que a sincronização não escreve lá). */
const klFingerprint = () => klSql(`select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by id), '')) from public.leads l`);

describe.skipIf(!RUN)('KAPA Leads → CRM ponta a ponta (local)', () => {
  let admin: SupabaseClient;
  const companyA = randomUUID();
  const companyB = randomUUID();
  const ids = { superAdmin: '', managerA: '', sellerA: '', managerB: '' };
  let linkId = '';
  let lead1: { leadId: string; submissionId: string };

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`sign_in_failed:${error.status}`);
    return client;
  }

  beforeAll(async () => {
    assertDisposableLocalDatabase();
    if (!/^supabase_db_kapa-[a-z0-9-]+$/.test(KL_CONTAINER)) throw new Error('kl_container_not_disposable');
    const klUrl = new URL(KL_URL);
    if (klUrl.hostname !== '127.0.0.1') throw new Error('kl_not_loopback');
    // A loja/campanha fictícias do seed do teste precisam existir no banco do KAPA Leads.
    expect(klSql(`select count(*) from public.stores where id = '${STORE_A}' and slug = 'loja-teste-a'`)).toBe('1');

    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const role of Object.keys(ids) as (keyof typeof ids)[]) {
      const { data, error } = await admin.auth.admin.createUser({ email: `kl-e2e-${role.toLowerCase()}-${run}@test.local`, password: PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error('create_user_failed');
      ids[role] = data.user.id;
    }
    crmSql(`
      insert into public.companies (id, name, status) values ('${companyA}', 'E2E Loja A ${run}', 'ativa'), ('${companyB}', 'E2E Loja B ${run}', 'ativa');
      insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values
        ('${companyA}', 'new', 'Novo', 0, false), ('${companyB}', 'new', 'Novo', 0, false);
      insert into public.profiles (id, name, email, is_active, platform_role) values
        ('${ids.superAdmin}', 'E2E Super', 'kl-e2e-superadmin-${run}@test.local', true, 'super_admin'),
        ('${ids.managerA}', 'E2E Manager A', 'kl-e2e-managera-${run}@test.local', true, null),
        ('${ids.sellerA}', 'E2E Seller A', 'kl-e2e-sellera-${run}@test.local', true, null),
        ('${ids.managerB}', 'E2E Manager B', 'kl-e2e-managerb-${run}@test.local', true, null);
      insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
        (gen_random_uuid(), '${companyA}', '${ids.managerA}', 'manager', true),
        ('${ids.sellerA}', '${companyA}', '${ids.sellerA}', 'seller', true),
        (gen_random_uuid(), '${companyB}', '${ids.managerB}', 'manager', true);
      insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
        ('e2eSeller${run}', '${companyA}', 'E2E Seller A', 'SA', '${ids.sellerA}', '${ids.sellerA}', true);
    `);
  }, 120_000);

  afterAll(async () => {
    if (!RUN || !admin) return;
    // Remove só o que este teste criou no CRM (o banco do KAPA Leads é descartável e só tem fixture).
    crmSql(`
      delete from public.kapa_leads_store_links where company_id in ('${companyA}', '${companyB}');
      delete from public.companies where id in ('${companyA}', '${companyB}');
      delete from public.profiles where id in ('${ids.superAdmin}', '${ids.managerA}', '${ids.sellerA}', '${ids.managerB}');
    `);
    for (const id of Object.values(ids)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it('a landing page grava no KAPA Leads antes de qualquer vínculo (nada vai ao CRM: sem retroativo)', async () => {
    const before = await lpSubmit(KEY_A, { phone: PHONE_3, name: 'Antes Da Ativacao' });
    expect(before.status).toBe(201);

    const superAdmin = await signIn(`kl-e2e-superadmin-${run}@test.local`);
    const upsert = await superAdmin.rpc('kapa_leads_link_upsert', { p_company_id: companyA, p_kapa_store_id: STORE_A, p_store_label: 'Loja Teste A' });
    expect(upsert.error).toBeNull();
    linkId = (upsert.data as { link_id: string }[])[0].link_id;
    // Manager não liga a sincronização.
    const manager = await signIn(`kl-e2e-managera-${run}@test.local`);
    const denied = await manager.rpc('kapa_leads_link_set_enabled', { p_company_id: companyA, p_link_id: linkId, p_enabled: true });
    expect(denied.error?.message).toBe('forbidden');
    const enabled = await superAdmin.rpc('kapa_leads_link_set_enabled', { p_company_id: companyA, p_link_id: linkId, p_enabled: true });
    expect(enabled.error).toBeNull();
  });

  it('o lead novo entra no KAPA Leads e, com o CRM fora do ar, a landing page não percebe nada', async () => {
    // CRM indisponível para o worker: o banco do CRM passa a uma porta fechada. (A parada física
    // do gateway do CRM durante um envio da landing page é feita pelo orquestrador, fora do guard.)
    const crmUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:3998';
    try {
      const created = await lpSubmit(KEY_A, { phone: PHONE_1, name: 'Maria Teste E2E' });
      expect(created.status).toBe(201);
      expect((created.body.simulation as { kind: string }).kind).toBe('ILLUSTRATIVE');
      lead1 = { leadId: String(created.body.leadId), submissionId: created.submissionId };
      // Outra loja (não liberada na exportação e sem vínculo no CRM).
      expect((await lpSubmit(KEY_B, { phone: PHONE_2, name: 'Outra Loja', formData: { desiredVehicleValueCents: 8000000 } })).status).toBe(201);
      // Ciclo com o CRM fora: falha controlada, sem exceção.
      const down = await cron();
      expect(down.status).toBe(500);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = crmUrl;
    }
    expect(klSql(`select count(*) from public.leads where id = '${lead1.leadId}'`)).toBe('1');
  }, 120_000);

  it('o KAPA Leads fora do ar não perde nada: o cursor não anda', async () => {
    const previous = process.env.KAPA_LEADS_API_URL;
    process.env.KAPA_LEADS_API_URL = 'http://127.0.0.1:3999';
    try {
      const result = await cron();
      expect(result.body).toMatchObject({ status: 'ok', sourceErrors: 1, received: 0 });
    } finally {
      process.env.KAPA_LEADS_API_URL = previous;
    }
    expect(crmSql(`select last_error_code || ':' || consecutive_failures from public.kapa_leads_store_links where id = '${linkId}'`))
      .toMatch(/^source_network:\d+$/);
    expect(crmSql(`select count(*) from public.kapa_leads_inbound_events where link_id = '${linkId}'`)).toBe('0');
  });

  it('depois da janela de confirmação, o ciclo traz o lead para o CRM, na empresa certa, sem vendedor', async () => {
    const fingerprintBefore = klFingerprint();
    await sleep(SETTLE_MS);
    const result = await cron();
    expect(result.body).toMatchObject({ status: 'ok', received: 1, created: 1, sourceErrors: 0 });
    // A sincronização é só leitura no KAPA Leads.
    expect(klFingerprint()).toBe(fingerprintBefore);

    const row = crmSql(`
      select row(l.company_id, l.seller_id is null, l.name, l.phone_digits, l.car, l.source, ps.code)::text
        from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
       where l.phone_digits = '${PHONE_1}'`);
    expect(row).toBe(`(${companyA},t,"Maria Teste E2E",${PHONE_1},"Não informado","Fábrica Teste (KAPA Leads)",new)`);
    // O lead anterior à ativação e o da outra loja não entraram.
    expect(crmSql(`select count(*) from public.leads where phone_digits in ('${PHONE_2}', '${PHONE_3}')`)).toBe('0');
    expect(crmSql(`select count(*) from public.leads where company_id = '${companyB}'`)).toBe('0');
    expect(crmSql(`select last_error_code is null from public.kapa_leads_store_links where id = '${linkId}'`)).toBe('t');
  }, 120_000);

  it('origem, simulação, consentimento e UTMs ficam no histórico do lead; Manager vê, outra empresa não', async () => {
    const leadId = crmSql(`select id from public.leads where phone_digits = '${PHONE_1}'`);
    const manager = await signIn(`kl-e2e-managera-${run}@test.local`);
    const { data, error } = await manager.rpc('list_lead_form_submissions_v2', { p_lead_id: leadId, p_company_id: companyA });
    expect(error).toBeNull();
    const [submission] = data as { source: string; source_detail: string; outcome: string; answers: { key: string; values: string[] }[] }[];
    expect(submission).toMatchObject({ source: 'kapa_leads', source_detail: 'Fábrica Teste (KAPA Leads)', outcome: 'created' });
    const answers = Object.fromEntries(submission.answers.map((a) => [a.key, a.values[0]]));
    expect(answers['Campanha']).toBe('Fábrica Teste');
    expect(answers['Possui veículo na troca']).toBe('Sim');
    expect(answers['Possui CNH']).toBe('Sim');
    expect(answers['Valor ilustrativo apresentado']).toMatch(/^R\$\s?\d{2}\.\d{3},\d{2} \(ilustrativo/);
    expect(answers['Validade do valor ilustrativo']).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    expect(answers['Nova simulação liberada a partir de']).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    expect(answers['Consentimento']).toMatch(/^Versão 2026-10-v1, aceito em/);
    expect(answers['utm_campaign']).toBe(`e2e-${run}`);
    expect(answers['ID no KAPA Leads']).toBe(lead1.leadId);
    // CPF e nascimento nunca saem do KAPA Leads.
    expect(JSON.stringify(data)).not.toMatch(/1990-05-20|cpf/i);

    const health = await manager.rpc('kapa_leads_sync_health', { p_company_id: companyA });
    expect((health.data as { processed_7d: number; pending_count: number }[])[0]).toMatchObject({ processed_7d: 1, pending_count: 0 });

    const managerB = await signIn(`kl-e2e-managerb-${run}@test.local`);
    expect((await managerB.rpc('list_lead_form_submissions_v2', { p_lead_id: leadId, p_company_id: companyA })).error).not.toBeNull();
    expect((await managerB.rpc('kapa_leads_sync_health', { p_company_id: companyA })).error?.message).toBe('forbidden');
  });

  it('o vendedor vê o lead e a origem depois de atribuído', async () => {
    const leadId = crmSql(`select id from public.leads where phone_digits = '${PHONE_1}'`);
    const seller = await signIn(`kl-e2e-sellera-${run}@test.local`);
    // Ainda sem vendedor: não é do vendedor.
    expect((await seller.rpc('list_lead_form_submissions_v2', { p_lead_id: leadId, p_company_id: companyA })).error).not.toBeNull();
    crmSql(`update public.leads set seller_id = 'e2eSeller${run}' where id = '${leadId}'`);
    const { data, error } = await seller.rpc('list_lead_form_submissions_v2', { p_lead_id: leadId, p_company_id: companyA });
    expect(error).toBeNull();
    expect((data as { source: string }[])[0].source).toBe('kapa_leads');
  });

  it('reenvio da landing page, novo ciclo e página repetida não duplicam', async () => {
    const resend = await lpSubmit(KEY_A, { phone: PHONE_1, name: 'Maria Teste E2E', submissionId: lead1.submissionId });
    expect(resend.status).toBe(200);
    expect(resend.body.leadId).toBe(lead1.leadId);
    expect((await cron()).body).toMatchObject({ received: 0, created: 0 });

    // Resposta "perdida": o cursor volta para a ativação e a mesma página é lida de novo.
    crmSql(`update public.kapa_leads_store_links set cursor_created_at = activated_at, cursor_lead_id = '00000000-0000-0000-0000-000000000000' where id = '${linkId}'`);
    expect((await cron()).body).toMatchObject({ received: 0, duplicates: 1, created: 0 });
    expect(crmSql(`select count(*) from public.leads where phone_digits = '${PHONE_1}'`)).toBe('1');
    expect(crmSql(`select count(*) from public.kapa_leads_inbound_events where link_id = '${linkId}'`)).toBe('1');
  }, 60_000);

  it('nova simulação do mesmo contato é associada ao lead existente, sem perder a origem', async () => {
    const second = await lpSubmit(KEY_A, { phone: PHONE_1, name: 'Maria Teste E2E', formData: { hasTradeIn: false, hasDownPayment: true, hasDriversLicense: true } });
    expect(second.status).toBe(201);
    await sleep(SETTLE_MS);
    expect((await cron()).body).toMatchObject({ received: 1, linked: 1, created: 0 });
    expect(crmSql(`select count(*) from public.leads where phone_digits = '${PHONE_1}'`)).toBe('1');
    expect(crmSql(`
      select string_agg(outcome, ',' order by created_at) from public.lead_form_submissions
       where lead_id = (select id from public.leads where phone_digits = '${PHONE_1}')`)).toBe('created,linked_existing');
    expect(crmSql(`select count(*) from public.kapa_leads_inbound_events where link_id = '${linkId}' and payload <> '{}'::jsonb`)).toBe('0');
  }, 120_000);

  it('pausar não para os simuladores e, ao religar, o lead do período entra', async () => {
    const superAdmin = await signIn(`kl-e2e-superadmin-${run}@test.local`);
    expect((await superAdmin.rpc('kapa_leads_link_set_enabled', { p_company_id: companyA, p_link_id: linkId, p_enabled: false })).error).toBeNull();
    const during = await lpSubmit(KEY_A, { phone: PHONE_2, name: 'Durante A Pausa' });
    expect(during.status).toBe(201);
    await sleep(SETTLE_MS);
    expect((await cron()).body).toMatchObject({ links: 0, received: 0 });
    expect((await superAdmin.rpc('kapa_leads_link_set_enabled', { p_company_id: companyA, p_link_id: linkId, p_enabled: true })).error).toBeNull();
    expect((await cron()).body).toMatchObject({ received: 1, created: 1 });
    expect(crmSql(`select company_id from public.leads where phone_digits = '${PHONE_2}'`)).toBe(companyA);
  }, 120_000);
});
