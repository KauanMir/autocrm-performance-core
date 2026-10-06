// @vitest-environment node
// META-INGESTION-P2.5A — sweep LOCAL real (claim em lote, processor, expiração
// de 7 dias). Graph FAKE. Só roda com META_P25A_LOCAL=1 e URL local. Cleanup
// verificado em zero.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { registerLeadgenEvent } from '@/lib/server/meta-webhook/leadgen-events-rpc';
import { createMetaLeadgenProcessorDeps, type MetaLeadProcessorDeps } from '@/lib/server/meta-webhook/process-leadgen-event';
import { sweepMetaLeadgenEvents } from '@/lib/server/meta-webhook/sweep-leadgen-events';

const RUN = process.env.META_P25A_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const PAGE = '940000000000601';
const FAKE_KEY_HEX = 'ef'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const FAKE_TOKEN = 'FAKE-PAGE-TOKEN-p25a-local-only';
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

// leadgen de 11 dígitos. Telefone derivado: segundo dígito do prefixo + últimos 7
// dígitos do leadgen, para que testes diferentes não colidam no mesmo telefone.
const leadgen = (prefix: string, i: number) => `${prefix}${String(i).padStart(9, '0')}`;
const derivedPhone = (leadgenId: string) => `61 9${leadgenId.slice(1, 2)}${leadgenId.slice(-7)}`;

describe.runIf(RUN)('META-INGESTION-P2.5A — sweep local real', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';
  const phoneOverride = new Map<string, string>();
  const fetchedLeadgens: string[] = [];

  function deps(): MetaLeadProcessorDeps {
    return {
      ...createMetaLeadgenProcessorDeps(),
      fetchLead: vi.fn(async (input: { leadgenId: string }) => {
        fetchedLeadgens.push(input.leadgenId);
        const phone = phoneOverride.get(input.leadgenId) ?? derivedPhone(input.leadgenId);
        return {
          ok: true as const,
          value: {
            id: input.leadgenId,
            fieldData: [
              { name: 'full_name', values: [`Cliente ${input.leadgenId}`] },
              { name: 'phone_number', values: [phone] },
            ],
          },
        };
      }),
    };
  }

  async function register(leadgenId: string): Promise<string> {
    const r = await registerLeadgenEvent({
      integrationId,
      companyId,
      pageId: PAGE,
      leadgenId,
      formId: null,
      receivedAt: new Date(),
    });
    if (!r.ok) throw new Error('fixture_register_failed');
    return r.value.eventId;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);

    const c = await admin().from('companies').insert({ name: `P25A Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `p25a-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;
    const profile = await admin()
      .from('profiles')
      .upsert({ id: userId, name: 'P25A Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    const values = STAGES.map(([code, name, order, terminal]) => `('${companyId}', '${code}', '${name}', ${order}, ${terminal})`).join(',\n');
    sql(`insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal) values\n${values};\n`);

    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: PAGE,
      p_page_name: 'Pagina P25A Fake',
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

  it('A. 23 eventos → um sweep processa no máximo 20; o restante fica para o próximo sweep', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 23; i += 1) ids.push(await register(leadgen('96', i)));

    const first = await sweepMetaLeadgenEvents({ deps: deps(), limit: 50 });
    expect(first.attempted).toBe(20);
    expect(first.created).toBe(20);
    const remaining = await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(remaining).toMatchObject({ attempted: 3, created: 3 });
    expect(ids).toHaveLength(23);
    const processed = sql(`select count(*) from public.meta_leadgen_events where company_id = '${companyId}' and status = 'processed';`).trim();
    expect(processed).toBe('23');
  });

  it('B. dois sweeps simultâneos → cada evento processado uma vez; um lead para o telefone compartilhado', async () => {
    phoneOverride.set(leadgen('97', 1), '61 98888-0001');
    phoneOverride.set(leadgen('97', 2), '61 98888-0001');
    for (let i = 1; i <= 10; i += 1) await register(leadgen('97', i));

    fetchedLeadgens.length = 0;
    const [s1, s2] = await Promise.all([
      sweepMetaLeadgenEvents({ deps: deps(), limit: 20 }),
      sweepMetaLeadgenEvents({ deps: deps(), limit: 20 }),
    ]);
    expect(s1.attempted + s2.attempted).toBe(10);
    expect(s1.created + s2.created).toBe(9);
    expect(s1.linkedExisting + s2.linkedExisting).toBe(1);
    expect(fetchedLeadgens.length).toBe(10);
    expect(new Set(fetchedLeadgens).size).toBe(10);

    const shared = sql(
      `select count(*) from public.leads where company_id = '${companyId}' and phone_digits = '61988880001';`,
    ).trim();
    expect(shared).toBe('1');
  });

  it('C. received com next_attempt_at futuro → não processado', async () => {
    const id = await register(leadgen('98', 1));
    sql(`update public.meta_leadgen_events set next_attempt_at = now() + interval '1 day' where id = '${id}';`);
    const s = await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(s.attempted).toBe(0);
    expect(sql(`select status from public.meta_leadgen_events where id = '${id}';`).trim()).toBe('received');
  });

  it('D. processing com lease ativa → não processado', async () => {
    const id = await register(leadgen('98', 2));
    const held = await admin().rpc('meta_leadgen_event_claim_batch', { p_event_id: id, p_limit: 1, p_lease_seconds: 300 });
    expect(held.data).toHaveLength(1);
    const s = await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(s.attempted).toBe(0);
    expect(sql(`select status from public.meta_leadgen_events where id = '${id}';`).trim()).toBe('processing');
  });

  it('E. processing com lease expirada → recuperado e processado', async () => {
    const id = await register(leadgen('98', 3));
    sql(
      `update public.meta_leadgen_events set status = 'processing', attempts = 1,` +
        ` lease_token = gen_random_uuid(), locked_until = now() - interval '1 minute' where id = '${id}';`,
    );
    const s = await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(s).toMatchObject({ attempted: 1, created: 1 });
    expect(sql(`select status from public.meta_leadgen_events where id = '${id}';`).trim()).toBe('processed');
  });

  it('F. evento com mais de 7 dias → failed/event_expired, sem Graph', async () => {
    const id = await register(leadgen('98', 4));
    sql(`update public.meta_leadgen_events set received_at = now() - interval '8 days' where id = '${id}';`);
    const graphBefore = fetchedLeadgens.length;
    const s = await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(s.attempted).toBe(0);
    expect(fetchedLeadgens.length).toBe(graphBefore);
    expect(sql(`select status || ':' || last_error_code from public.meta_leadgen_events where id = '${id}';`).trim())
      .toBe('failed:event_expired');
  });

  it('G. retry operacional com mais de 7 dias → event_expired', async () => {
    const id = await register(leadgen('98', 5));
    sql(
      `update public.meta_leadgen_events set status = 'received', attempts = 0, last_error_code = 'token_invalid',` +
        ` next_attempt_at = now() + interval '1 hour', received_at = now() - interval '8 days' where id = '${id}';`,
    );
    const graphBefore = fetchedLeadgens.length;
    await sweepMetaLeadgenEvents({ deps: deps(), limit: 20 });
    expect(fetchedLeadgens.length).toBe(graphBefore);
    expect(sql(`select status || ':' || last_error_code from public.meta_leadgen_events where id = '${id}';`).trim())
      .toBe('failed:event_expired');
  });
});
