// @vitest-environment node
// META-INGESTION-P2.3 — processor end-to-end LOCAL: adapter real, RPCs reais,
// decrypt real com chave fake, Graph FAKE. Só roda com META_P23_LOCAL=1 e URL
// local. Valor: valida nomes e parâmetros reais das RPCs, o AAD do decrypt e o
// caminho complete/fail contra o banco. Cleanup verificado em zero.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { registerLeadgenEvent } from '@/lib/server/meta-webhook/leadgen-events-rpc';
import {
  createMetaLeadgenProcessorDeps,
  processMetaLeadgenEvent,
} from '@/lib/server/meta-webhook/process-leadgen-event';

const RUN = process.env.META_P23_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const PAGE = '940000000000401';
const FAKE_KEY_HEX = 'ab'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const FAKE_TOKEN = 'FAKE-PAGE-TOKEN-p2-3-local-only';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
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

function fakeGraphFetch(phone: string) {
  return vi.fn(async (_input: { graphApiVersion: string; leadgenId: string; pageAccessToken: string }) => ({
    ok: true as const,
    value: {
      id: '0',
      fieldData: [
        { name: 'full_name', values: ['Cliente Processor Fake'] },
        { name: 'phone_number', values: [phone] },
      ],
    },
  }));
}

describe.runIf(RUN)('META-INGESTION-P2.3 — processor local (adapter e RPCs reais)', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';
  const eventIds: string[] = [];

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
    eventIds.push(r.value.eventId);
    return r.value.eventId;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);

    const c = await admin().from('companies').insert({ name: `P23 Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `p23-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;
    const profile = await admin()
      .from('profiles')
      .upsert({ id: userId, name: 'P23 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    const values = STAGES.map(([code, name, order, terminal]) => `('${companyId}', '${code}', '${name}', ${order}, ${terminal})`).join(',\n');
    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values\n${values};\n`);

    const ciphertext = encryptMetaPageToken({ plaintextToken: FAKE_TOKEN, companyId, pageId: PAGE, key: FAKE_KEY });
    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: PAGE,
      p_page_name: 'Pagina P23 Fake',
      p_access_token_ciphertext: ciphertext,
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
      vi.unstubAllEnvs();
      if (companyId) {
        const counts = sql(
          `select (select count(*) from public.meta_leadgen_events where company_id = '${companyId}') || ',' ||` +
            ` (select count(*) from public.leads where company_id = '${companyId}') || ',' ||` +
            ` (select count(*) from public.companies where id = '${companyId}');`,
        ).trim();
        expect(counts).toBe('0,0,0');
      }
    }
  });

  it('1. evento nacional → created, token decifrado só em memória e lead com telefone canônico', async () => {
    const fetchLead = fakeGraphFetch('+55 61 96666-0101');
    const deps = { ...createMetaLeadgenProcessorDeps(), fetchLead };
    const eventId = await registerEvent('950000000000401');

    const result = await processMetaLeadgenEvent(eventId, deps);
    expect(result).toEqual({ outcome: 'created' });
    expect(fetchLead).toHaveBeenCalledWith(expect.objectContaining({ pageAccessToken: FAKE_TOKEN, leadgenId: '950000000000401' }));
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);

    const lead = sql(
      `select name || '|' || phone || '|' || source || '|' || coalesce(seller_id, 'null') from public.leads` +
        ` where company_id = '${companyId}' and phone_digits = '61966660101';`,
    ).trim();
    expect(lead).toBe('Cliente Processor Fake|61966660101|Meta Lead Ads|null');
    const status = sql(
      `select status from public.meta_leadgen_events where id = '${eventId}';`,
    ).trim();
    expect(status).toBe('processed');
  });

  it('2. segundo evento, mesmo telefone → linked_existing, sem segundo lead', async () => {
    const deps = { ...createMetaLeadgenProcessorDeps(), fetchLead: fakeGraphFetch('61 96666-0101') };
    const eventId = await registerEvent('950000000000402');

    expect(await processMetaLeadgenEvent(eventId, deps)).toEqual({ outcome: 'linked_existing' });
    const count = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '61966660101';`,
    ).trim();
    expect(count).toBe('1');
  });

  it('3. ciphertext adulterado → token_decrypt_failed; evento volta a received sem consumir tentativa', async () => {
    sql(
      `update public.company_meta_integrations set access_token_ciphertext = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC'` +
        ` where id = '${integrationId}';`,
    );
    const fetchLead = fakeGraphFetch('61 96666-0102');
    const deps = { ...createMetaLeadgenProcessorDeps(), fetchLead };
    const eventId = await registerEvent('950000000000403');

    expect(await processMetaLeadgenEvent(eventId, deps)).toEqual({
      outcome: 'failed',
      errorCode: 'token_decrypt_failed',
    });
    expect(fetchLead).not.toHaveBeenCalled();
    const row = sql(
      `select status || '|' || attempts || '|' || last_error_code || '|' || (next_attempt_at > now() + interval '59 minutes')` +
        ` from public.meta_leadgen_events where id = '${eventId}';`,
    ).trim();
    expect(row).toBe('received|0|token_decrypt_failed|true');
  });
});
