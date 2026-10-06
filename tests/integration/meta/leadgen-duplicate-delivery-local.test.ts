// @vitest-environment node
// META-INGESTION-P2.4 — entregas duplicadas do mesmo leadgen, LOCAL e real
// (ledger + claim + complete). Graph FAKE. Só roda com META_P24_LOCAL=1 e URL
// local. Cleanup verificado em zero.
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

const RUN = process.env.META_P24_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const PAGE = '940000000000501';
const FAKE_KEY_HEX = 'cd'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const FAKE_TOKEN = 'FAKE-PAGE-TOKEN-p2-4-local-only';
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

describe.runIf(RUN)('META-INGESTION-P2.4 — entregas duplicadas (local real)', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';

  beforeAll(async () => {
    assertLocalSupabase();
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);

    const c = await admin().from('companies').insert({ name: `P24 Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `p24-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;
    const profile = await admin()
      .from('profiles')
      .upsert({ id: userId, name: 'P24 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    const values = STAGES.map(([code, name, order, terminal]) => `('${companyId}', '${code}', '${name}', ${order}, ${terminal})`).join(',\n');
    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values\n${values};\n`);

    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: PAGE,
      p_page_name: 'Pagina P24 Fake',
      p_access_token_ciphertext: encryptMetaPageToken({ plaintextToken: FAKE_TOKEN, companyId, pageId: PAGE, key: FAKE_KEY }),
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

  it('cinco entregas simultâneas do mesmo leadgen → uma linha no ledger', async () => {
    const leadgenId = '950000000000501';
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        registerLeadgenEvent({ integrationId, companyId, pageId: PAGE, leadgenId, formId: null, receivedAt: new Date() }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => (r.ok ? r.value.eventId : '')));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.ok && r.value.created)).toHaveLength(1);
    const rows = sql(
      `select count(*) from public.meta_leadgen_events where company_id = '${companyId}' and leadgen_id = '${leadgenId}';`,
    ).trim();
    expect(rows).toBe('1');
  });

  it('cinco processamentos simultâneos do mesmo evento → um processamento efetivo, um lead', async () => {
    const leadgenId = '950000000000501';
    const eventId = sql(
      `select id from public.meta_leadgen_events where company_id = '${companyId}' and leadgen_id = '${leadgenId}';`,
    ).trim();
    const fetchLead = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: leadgenId,
        fieldData: [
          { name: 'full_name', values: ['Cliente Duplicado Fake'] },
          { name: 'phone_number', values: ['+55 61 95555-0501'] },
        ],
      },
    }));
    const deps = { ...createMetaLeadgenProcessorDeps(), fetchLead };

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => processMetaLeadgenEvent(eventId, deps)));
    const counts = outcomes.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.created).toBe(1);
    expect(counts.not_claimed).toBe(4);
    expect(fetchLead).toHaveBeenCalledTimes(1);

    const leads = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '61955550501';`,
    ).trim();
    expect(leads).toBe('1');
    const status = sql(`select status from public.meta_leadgen_events where id = '${eventId}';`).trim();
    expect(status).toBe('processed');
  });
});
