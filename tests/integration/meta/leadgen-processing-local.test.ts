// @vitest-environment node
// META-INGESTION-P2.2 — integração LOCAL real contra o Supabase local. Só roda
// com META_P22_LOCAL=1 e URL local. Somente IDs e telefones fictícios; sem
// Graph, sem decrypt, sem processor. Cleanup verificado em zero.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { registerLeadgenEvent } from '@/lib/server/meta-webhook/leadgen-events-rpc';

const RUN = process.env.META_P22_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const PAGE = '940000000000201';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const FAKE_CIPHERTEXT = `v1.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(8)}`;
const STAGES = [
  ['new', 'Novo', 0, false],
  ['qualified', 'Qualificado', 1, false],
  ['visit_scheduled', 'Visita agendada', 2, false],
  ['negotiation', 'Em negociação', 3, false],
  ['closing', 'Fechamento', 4, true],
] as const;

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA'], {
    input: statement,
    encoding: 'utf8',
  });
}

function assertLocalSupabase(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error('refusing to run: supabase url is not local');
  }
}

describe.runIf(RUN)('META-INGESTION-P2.2 — processamento local real', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';
  const created: string[] = [];

  async function registerEvent(leadgenId: string): Promise<string> {
    const r = await registerLeadgenEvent({
      integrationId,
      companyId,
      pageId: PAGE,
      leadgenId,
      formId: null,
      receivedAt: new Date(),
    });
    if (!r.ok) throw new Error('fixture_register_failed');
    created.push(r.value.eventId);
    return r.value.eventId;
  }

  async function claim(eventId: string) {
    const { data, error } = await admin().rpc('meta_leadgen_event_claim_batch', {
      p_event_id: eventId,
      p_limit: 20,
      p_lease_seconds: 90,
    });
    if (error) throw new Error(`claim_failed:${error.message}`);
    return data?.[0] ?? null;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    const c = await admin().from('companies').insert({ name: `P22 Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `p22-${suffix}@test.local`;
    const created_user = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created_user.error || !created_user.data.user) throw new Error('fixture_user_failed');
    userId = created_user.data.user.id;
    const profile = await admin()
      .from('profiles')
      .upsert({ id: userId, name: 'P22 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    const values = STAGES.map(
      ([code, name, order, terminal]) =>
        `('${companyId}', '${code}', '${name}', ${order}, ${terminal})`,
    ).join(',\n');
    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values\n${values};\n`);

    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: PAGE,
      p_page_name: 'Pagina P22 Fake',
      p_access_token_ciphertext: FAKE_CIPHERTEXT,
      p_token_key_version: 1,
      p_granted_scopes: [...REQUIRED],
      p_connected_at: new Date('2026-10-05T12:00:00.000Z').toISOString(),
      p_connected_by: userId,
      p_leadgen_subscribed_at: new Date('2026-10-05T12:00:01.000Z').toISOString(),
    });
    if (upsert.error || !upsert.data?.[0]) throw new Error('fixture_integration_failed');
    integrationId = upsert.data[0].id;
  });

  afterAll(() => {
    try {
      if (companyId) {
        sql(
          `drop trigger if exists p22_force_processed_failure on public.meta_leadgen_events;\n` +
            `drop function if exists public.p22_force_processed_failure();\n` +
            `delete from public.meta_leadgen_events where company_id = '${companyId}';\n` +
            `delete from public.lead_timeline_entries where company_id = '${companyId}';\n` +
            `delete from public.leads where company_id = '${companyId}';\n` +
            `delete from public.pipeline_stages where company_id = '${companyId}';\n` +
            `delete from public.audit_log where company_id = '${companyId}';\n` +
            `delete from public.company_meta_integrations where company_id = '${companyId}';\n` +
            `delete from public.companies where id = '${companyId}';\n` +
            `delete from auth.users where id = '${userId}';\n`,
        );
      }
    } finally {
      const counts = sql(
        `select (select count(*) from public.meta_leadgen_events where company_id = '${companyId}') || ',' ||` +
          ` (select count(*) from public.leads where company_id = '${companyId}') || ',' ||` +
          ` (select count(*) from public.companies where id = '${companyId}');`,
      ).trim();
      expect(counts).toBe('0,0,0');
    }
  });

  it('A. dois workers claimando o mesmo event: só um lease vence', async () => {
    const eventId = await registerEvent('950000000000301');
    const [first, second] = await Promise.all([claim(eventId), claim(eventId)]);
    const winners = [first, second].filter((row) => row !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.out_attempts).toBe(1);
    expect(winners[0]?.out_lease_token).toBeTruthy();
  });

  it('B. dois events diferentes, mesmo telefone, complete simultâneo: um lead, dois events vinculados', async () => {
    const e1 = await registerEvent('950000000000302');
    const e2 = await registerEvent('950000000000303');
    const c1 = await claim(e1);
    const c2 = await claim(e2);
    expect(c1 && c2).toBeTruthy();

    const phone = '61977770001';
    const [r1, r2] = await Promise.all([
      admin().rpc('meta_leadgen_event_complete', {
        p_event_id: e1,
        p_lease_token: c1!.out_lease_token,
        p_name: 'Cliente Concorrente 1',
        p_phone: phone,
        p_car: 'Não informado',
      }),
      admin().rpc('meta_leadgen_event_complete', {
        p_event_id: e2,
        p_lease_token: c2!.out_lease_token,
        p_name: 'Cliente Concorrente 2',
        p_phone: phone,
        p_car: 'Não informado',
      }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const outcomes = [r1.data?.[0]?.out_outcome, r2.data?.[0]?.out_outcome].sort();
    expect(outcomes).toEqual(['created', 'linked_existing']);

    const leadRows = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '${phone}';`,
    ).trim();
    expect(leadRows).toBe('1');

    const linked = sql(
      `select count(distinct crm_lead_id) || ':' || count(*) from public.meta_leadgen_events` +
        ` where id in ('${e1}', '${e2}') and status = 'processed';`,
    ).trim();
    expect(linked).toBe('1:2');
  });

  it('C. falha forçada depois da criação do lead: rollback completo, sem lead órfão', async () => {
    const eventId = await registerEvent('950000000000304');
    const claimed = await claim(eventId);
    const phone = '61977770002';

    sql(
      `create or replace function public.p22_force_processed_failure() returns trigger language plpgsql as $$\n` +
        `begin raise exception 'forced_after_insert'; end; $$;\n` +
        `drop trigger if exists p22_force_processed_failure on public.meta_leadgen_events;\n` +
        `create trigger p22_force_processed_failure before update on public.meta_leadgen_events\n` +
        `  for each row when (new.status = 'processed') execute function public.p22_force_processed_failure();\n`,
    );

    try {
      const result = await admin().rpc('meta_leadgen_event_complete', {
        p_event_id: eventId,
        p_lease_token: claimed!.out_lease_token,
        p_name: 'Cliente Rollback',
        p_phone: phone,
        p_car: 'Não informado',
      });
      expect(result.error).not.toBeNull();
    } finally {
      sql(
        `drop trigger if exists p22_force_processed_failure on public.meta_leadgen_events;\n` +
          `drop function if exists public.p22_force_processed_failure();\n`,
      );
    }

    const orphans = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '${phone}';`,
    ).trim();
    expect(orphans).toBe('0');
    const status = sql(
      `select status || ':' || coalesce(crm_lead_id::text, 'null') from public.meta_leadgen_events where id = '${eventId}';`,
    ).trim();
    expect(status).toBe('processing:null');
  });

  it('E. lead existente salvo como +55 + evento Meta nacional → linked_existing, sem segundo lead', async () => {
    const stored = sql(
      `insert into public.leads (company_id, name, phone, car, stage_id)\n` +
        `values ('${companyId}', 'Cliente DDI Fake', '+55 61 97777-0004', 'Onix',\n` +
        `  (select id from public.pipeline_stages where company_id = '${companyId}' and code = 'new'))\n` +
        `returning id;\n`,
    )
      .trim()
      .split('\n')[0]
      .trim();
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);

    const eventId = await registerEvent('950000000000306');
    const claimed = await claim(eventId);
    const result = await admin().rpc('meta_leadgen_event_complete', {
      p_event_id: eventId,
      p_lease_token: claimed!.out_lease_token,
      p_name: 'Cliente DDI Meta',
      p_phone: '61977770004',
      p_car: 'Não informado',
    });
    expect(result.error).toBeNull();
    expect(result.data?.[0]?.out_outcome).toBe('linked_existing');
    expect(result.data?.[0]?.out_crm_lead_id).toBe(stored);

    const count = sql(
      `select count(*) from public.leads where company_id = '${companyId}'` +
        ` and phone_digits in ('61977770004', '5561977770004');`,
    ).trim();
    expect(count).toBe('1');
  });

  it('D. evento sem lease válida não cria lead (lease_lost)', async () => {
    const eventId = await registerEvent('950000000000305');
    await claim(eventId);
    const wrong = await admin().rpc('meta_leadgen_event_complete', {
      p_event_id: eventId,
      p_lease_token: '00000000-0000-4000-8000-000000000000',
      p_name: 'Cliente Lease',
      p_phone: '61977770003',
      p_car: 'Não informado',
    });
    expect(wrong.data?.[0]?.out_outcome).toBe('lease_lost');
    const leads = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '61977770003';`,
    ).trim();
    expect(leads).toBe('0');
  });
});
