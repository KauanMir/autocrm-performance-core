// @vitest-environment node
// META-MVP1 — ponta a ponta LOCAL com adaptador real, RPCs reais (PostgREST +
// Postgres), decrypt real com chave fake e Graph FAKE. Só roda com
// META_MVP1_LOCAL=1 e URL local. Cobre: respostas preservadas, mapeamento por
// formulário, lead existente não sobrescrito, conexão marcada como erro,
// ingestão com conexão em erro e token vencido. Cleanup verificado em zero.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { registerLeadgenEvent } from '@/lib/server/meta-webhook/leadgen-events-rpc';
import type { GraphLeadResult } from '@/lib/server/meta-webhook/graph-lead';
import {
  createMetaLeadgenProcessorDeps,
  processMetaLeadgenEvent,
  type MetaLeadProcessorDeps,
} from '@/lib/server/meta-webhook/process-leadgen-event';

const RUN = process.env.META_MVP1_LOCAL === '1';
const CONTAINER = process.env.META_LOCAL_DB_CONTAINER ?? 'supabase_db_autocrm-performance-core';
const PAGE = '940000000000901';
const FORM = '1086000000000901';
const FAKE_KEY_HEX = 'cd'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const FAKE_TOKEN = 'FAKE-PAGE-TOKEN-mvp1-local-only';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];

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

function graphReturning(result: GraphLeadResult) {
  return vi.fn(async () => result);
}

function leadWith(fields: { name: string; values: string[] }[]): GraphLeadResult {
  return {
    ok: true,
    value: { id: '0', fieldData: fields, createdTime: '2026-11-05T12:00:00.000Z', adId: '120000000000901', formId: FORM },
  };
}

describe.runIf(RUN)('META-MVP1 — processamento local ponta a ponta', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';
  const logs: unknown[] = [];

  const deps = (fetchLead: MetaLeadProcessorDeps['fetchLead']): MetaLeadProcessorDeps => ({
    ...createMetaLeadgenProcessorDeps(),
    fetchLead,
    log: (fields) => logs.push(fields),
  });

  async function registerEvent(leadgenId: string): Promise<string> {
    const r = await registerLeadgenEvent({ integrationId, companyId, pageId: PAGE, leadgenId, formId: FORM, receivedAt: new Date() });
    if (!r.ok) throw new Error('fixture_register_failed');
    return r.value.eventId;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);

    const c = await admin().from('companies').insert({ name: `MVP1 Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `mvp1-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;
    const profile = await admin().from('profiles').upsert({ id: userId, name: 'MVP1 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values ('${companyId}', 'new', 'Novo', 0, false);`);
    sql(`insert into public.meta_lead_form_mappings (company_id, form_id, target, field_key) values ('${companyId}', '${FORM}', 'vehicle', 'qual_carro');`);

    const ciphertext = encryptMetaPageToken({ plaintextToken: FAKE_TOKEN, companyId, pageId: PAGE, key: FAKE_KEY });
    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: PAGE,
      p_page_name: 'Pagina MVP1 Fake',
      p_access_token_ciphertext: ciphertext,
      p_token_key_version: 1,
      p_granted_scopes: [...REQUIRED],
      p_connected_at: new Date().toISOString(),
      p_connected_by: userId,
      p_leadgen_subscribed_at: new Date().toISOString(),
      p_token_origin: 'exchanged_long_lived',
      p_token_expires_at: null,
      p_token_data_access_expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
      p_token_checked_at: new Date().toISOString(),
    });
    if (upsert.error || !upsert.data?.[0]) throw new Error('fixture_integration_failed');
    integrationId = upsert.data[0].id;
  });

  afterAll(() => {
    try {
      if (companyId) {
        sql(
          `delete from public.meta_leadgen_events where company_id = '${companyId}';\n` +
            `delete from public.lead_form_submissions where company_id = '${companyId}';\n` +
            `delete from public.lead_timeline_entries where company_id = '${companyId}';\n` +
            `delete from public.leads where company_id = '${companyId}';\n` +
            `delete from public.meta_lead_form_mappings where company_id = '${companyId}';\n` +
            `delete from public.pipeline_stages where company_id = '${companyId}';\n` +
            `delete from public.audit_log where company_id = '${companyId}';\n` +
            `delete from public.company_meta_integrations where company_id = '${companyId}';\n` +
            `delete from public.companies where id = '${companyId}';\n` +
            `delete from auth.users where id = '${userId}';\n`,
        );
      }
    } finally {
      vi.unstubAllEnvs();
      if (companyId) {
        const counts = sql(
          `select (select count(*) from public.meta_leadgen_events where company_id = '${companyId}') || ',' ||` +
            ` (select count(*) from public.lead_form_submissions where company_id = '${companyId}') || ',' ||` +
            ` (select count(*) from public.leads where company_id = '${companyId}') || ',' ||` +
            ` (select count(*) from public.companies where id = '${companyId}');`,
        ).trim();
        expect(counts).toBe('0,0,0,0');
      }
    }
  });

  it('1. lead novo: veículo pelo mapeamento, e-mail e perguntas preservados, CPF omitido', async () => {
    const eventId = await registerEvent('950000000000901');
    const fetchLead = graphReturning(leadWith([
      { name: 'full_name', values: ['Cliente MVP1 Local'] },
      { name: 'phone_number', values: ['+55 61 97777-0901'] },
      { name: 'email', values: ['Local@Test.Local'] },
      { name: 'qual_carro', values: ['Onix 2024'] },
      { name: 'forma_pagamento', values: ['Financiamento'] },
      { name: 'cpf', values: ['000.000.000-00'] },
    ]));
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'created' });

    expect(sql(`select car || '|' || source from public.leads where company_id = '${companyId}' and phone_digits = '61977770901';`).trim())
      .toBe('Onix 2024|Meta Lead Ads');
    const submission = sql(
      `select outcome || '|' || contact_email || '|' || vehicle_interest || '|' || answers::text || '|' || ad_id` +
        ` from public.lead_form_submissions where meta_event_id = '${eventId}';`,
    ).trim();
    expect(submission).toBe('created|local@test.local|Onix 2024|[{"key": "forma_pagamento", "values": ["Financiamento"]}]|120000000000901');
    expect(sql(`select count(*) from public.lead_form_submissions where answers::text like '%000.000.000%';`).trim()).toBe('0');
    expect(sql(`select status from public.meta_leadgen_events where id = '${eventId}';`).trim()).toBe('processed');
  });

  it('2. mesmo telefone: lead existente intacto, nova submissão e histórico', async () => {
    const before = sql(`select name || '|' || car || '|' || version from public.leads where company_id = '${companyId}' and phone_digits = '61977770901';`).trim();
    const eventId = await registerEvent('950000000000902');
    const fetchLead = graphReturning(leadWith([
      { name: 'full_name', values: ['Nome Diferente'] },
      { name: 'phone_number', values: ['61 97777-0901'] },
      { name: 'qual_carro', values: ['Tracker'] },
    ]));
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'linked_existing' });
    expect(sql(`select name || '|' || car || '|' || version from public.leads where company_id = '${companyId}' and phone_digits = '61977770901';`).trim())
      .toBe(before);
    expect(sql(`select count(*) from public.lead_form_submissions where company_id = '${companyId}';`).trim()).toBe('2');
    expect(sql(`select count(*) from public.lead_timeline_entries where company_id = '${companyId}' and label = 'Novo formulário Meta recebido';`).trim())
      .toBe('1');
  });

  it('3. Meta recusa o token (190): conexão marcada como erro, evento aguardando, sem lead', async () => {
    const eventId = await registerEvent('950000000000903');
    const fetchLead = graphReturning({ ok: false, code: 'token_invalid' });
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'failed', errorCode: 'token_invalid' });
    expect(sql(`select status || '|' || last_error_code from public.company_meta_integrations where id = '${integrationId}';`).trim())
      .toBe('error|token_invalid');
    expect(sql(`select status || '|' || last_error_code from public.meta_leadgen_events where id = '${eventId}';`).trim())
      .toBe('received|token_invalid');
  });

  it('4. com a conexão em erro, um novo evento AINDA é registrado no ledger (não é descartado)', async () => {
    const eventId = await registerEvent('950000000000904');
    expect(sql(`select status from public.meta_leadgen_events where id = '${eventId}';`).trim()).toBe('received');
    // Processar não chama a Graph: espera reconexão.
    const fetchLead = graphReturning(leadWith([]));
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'failed', errorCode: 'token_invalid' });
    expect(fetchLead).not.toHaveBeenCalled();
  });

  it('5. reconexão (upsert v2) volta a connected; acesso a dados vencido marca token_expired sem chamar a Graph', async () => {
    const ciphertext = encryptMetaPageToken({ plaintextToken: FAKE_TOKEN, companyId, pageId: PAGE, key: FAKE_KEY });
    const reconnected = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId, p_page_id: PAGE, p_page_name: 'Pagina MVP1 Fake', p_access_token_ciphertext: ciphertext,
      p_token_key_version: 1, p_granted_scopes: [...REQUIRED], p_connected_at: new Date().toISOString(), p_connected_by: userId,
      p_leadgen_subscribed_at: new Date().toISOString(), p_token_origin: 'original_token', p_token_expires_at: null,
      p_token_data_access_expires_at: null, p_token_checked_at: new Date().toISOString(),
    });
    expect(reconnected.error).toBeNull();
    expect(sql(`select status from public.company_meta_integrations where id = '${integrationId}';`).trim()).toBe('connected');

    sql(`update public.company_meta_integrations set token_data_access_expires_at = now() - interval '1 minute' where id = '${integrationId}';`);
    const eventId = await registerEvent('950000000000905');
    const fetchLead = graphReturning(leadWith([]));
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'failed', errorCode: 'token_expired' });
    expect(fetchLead).not.toHaveBeenCalled();
    expect(sql(`select status || '|' || last_error_code from public.company_meta_integrations where id = '${integrationId}';`).trim())
      .toBe('error|token_expired');
  });

  it('7. duas execuções concorrentes do mesmo evento (ex.: reprocessar + sweep) → um lead, uma submissão', async () => {
    sql(`update public.company_meta_integrations set status = 'connected', last_error_code = null, token_data_access_expires_at = null where id = '${integrationId}';`);
    const eventId = await registerEvent('950000000000907');
    const fetchLead = graphReturning(leadWith([
      { name: 'full_name', values: ['Cliente Concorrente'] },
      { name: 'phone_number', values: ['61 97777-0907'] },
    ]));
    const results = await Promise.all([
      processMetaLeadgenEvent(eventId, deps(fetchLead)),
      processMetaLeadgenEvent(eventId, deps(fetchLead)),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['created', 'not_claimed']);
    expect(sql(`select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '61977770907';`).trim()).toBe('1');
    expect(sql(`select count(*) from public.lead_form_submissions where meta_event_id = '${eventId}';`).trim()).toBe('1');
    // Evento processado não volta a ser processado.
    expect(await processMetaLeadgenEvent(eventId, deps(fetchLead))).toEqual({ outcome: 'not_claimed' });
  });

  it('8. sem agendador: evento recebido e nunca processado aparece como PARADO na fila', async () => {
    const eventId = await registerEvent('950000000000908');
    sql(`update public.meta_leadgen_events set next_attempt_at = now() - interval '1 hour', received_at = now() - interval '1 hour' where id = '${eventId}';`);
    sql(`update public.profiles set platform_role = 'super_admin' where id = '${userId}';`);
    const state = sql(
      [
        'begin;',
        `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);`,
        `select review_state from public.meta_leadgen_review_list('${companyId}', 50) where event_id = '${eventId}';`,
        'rollback;',
      ].join('\n'),
    ).split('\n').map((line) => line.trim());
    // psql imprime também BEGIN/ROLLBACK e o set_config; só uma linha é o estado.
    expect(state.filter((line) => ['stuck', 'retrying', 'failed'].includes(line))).toEqual(['stuck']);
  });

  it('6. logs: UUID interno e contadores, nunca token, nome, telefone, e-mail ou IDs da Meta', () => {
    const serialized = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThanOrEqual(5);
    for (const forbidden of [FAKE_TOKEN, 'Cliente MVP1 Local', '61977770901', 'local@test.local', 'Onix 2024', PAGE, '950000000000901']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
