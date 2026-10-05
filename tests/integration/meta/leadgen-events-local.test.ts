// @vitest-environment node
// META-INGESTION-P1 — integração LOCAL real contra o Supabase local. Só roda
// com META_P1_LOCAL=1. Usa SOMENTE IDs fake (company/page/leadgen de fixture)
// e nunca a company ou a Page de teste reais. Não chama Graph, não decifra
// token, não cria lead CRM. Ao final, as linhas de fixture são removidas e a
// contagem é verificada como zero.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { registerLeadgenEvent } from '@/lib/server/meta-webhook/leadgen-events-rpc';

const RUN = process.env.META_P1_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const FAKE_PAGE = '930000000000001';
const FAKE_PAGE_OTHER = '930000000000002';
const FAKE_LEADGEN = '940000000000001';
const FAKE_LEADGEN_CONCURRENT = '940000000000002';
const FAKE_LEADGEN_CONCURRENT_EXTRA = '940000000000003';
const FAKE_FORM = '950000000000001';
const FAKE_TOKEN_CIPHERTEXT = `v1.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(8)}`;

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

describe.runIf(RUN)('META-INGESTION-P1 — ledger local real', () => {
  const admin = () => createAdminClient();
  const suffix = randomBytes(4).toString('hex');
  let companyId = '';
  let userId = '';
  let integrationId = '';

  beforeAll(async () => {
    assertLocalSupabase();
    const c = await admin().from('companies').insert({ name: `P1 Fixture ${suffix}` }).select('id').single();
    if (c.error || !c.data) throw new Error('fixture_company_failed');
    companyId = c.data.id;

    const email = `p1-${suffix}@test.local`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;

    const profile = await admin()
      .from('profiles')
      .upsert({ id: userId, name: 'P1 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error('fixture_profile_failed');

    const upsert = await createMetaConnectionRpcPort().upsert({
      p_company_id: companyId,
      p_page_id: FAKE_PAGE,
      p_page_name: 'Pagina P1 Fake',
      p_access_token_ciphertext: FAKE_TOKEN_CIPHERTEXT,
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
            `delete from public.audit_log where action = 'meta_connection_upserted' and company_id = '${companyId}';\n` +
            `delete from public.company_meta_integrations where company_id = '${companyId}';\n` +
            `delete from public.companies where id = '${companyId}';\n` +
            `delete from auth.users where id = '${userId}';\n`,
        );
      }
    } finally {
      const remaining = sql(
        `select count(*) from public.meta_leadgen_events where company_id = '${companyId}';`,
      ).trim();
      expect(remaining).toBe('0');
    }
  });

  const register = (leadgenId: string, pageId = FAKE_PAGE) =>
    registerLeadgenEvent({
      integrationId,
      companyId,
      pageId,
      leadgenId,
      formId: FAKE_FORM,
      receivedAt: new Date(),
    });

  it('owner lookup retorna a company da fixture (sem ciphertext)', async () => {
    const owner = await createMetaConnectionRpcPort().ownerByPage(FAKE_PAGE);
    expect(owner.error).toBeNull();
    expect(owner.data?.[0]).toMatchObject({ integration_id: integrationId, company_id: companyId, status: 'connected' });
    expect(JSON.stringify(owner.data)).not.toContain('v1.');
  });

  it('mesmo evento entregue 1, 5 e 20 vezes → uma única linha, mesmo event id', async () => {
    const first = await register(FAKE_LEADGEN);
    expect(first).toMatchObject({ ok: true, value: { created: true, status: 'received' } });
    if (!first.ok) return;
    const eventId = first.value.eventId;

    for (let i = 0; i < 4; i += 1) {
      const again = await register(FAKE_LEADGEN);
      expect(again).toMatchObject({ ok: true, value: { created: false, eventId } });
    }
    const after5 = sql(
      `select count(*) from public.meta_leadgen_events where page_id = '${FAKE_PAGE}' and leadgen_id = '${FAKE_LEADGEN}';`,
    ).trim();
    expect(after5).toBe('1');

    for (let i = 0; i < 15; i += 1) {
      const again = await register(FAKE_LEADGEN);
      expect(again).toMatchObject({ ok: true, value: { created: false, eventId } });
    }
    const after20 = sql(
      `select count(*) from public.meta_leadgen_events where page_id = '${FAKE_PAGE}' and leadgen_id = '${FAKE_LEADGEN}';`,
    ).trim();
    expect(after20).toBe('1');
  });

  it('concorrência: 10 entregas simultâneas do mesmo leadgen → uma única linha', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => register(FAKE_LEADGEN_CONCURRENT)));
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => (r.ok ? r.value.eventId : '')));
    expect(ids.size).toBe(1);
    const created = results.filter((r) => r.ok && r.value.created).length;
    expect(created).toBe(1);
    const count = sql(
      `select count(*) from public.meta_leadgen_events where page_id = '${FAKE_PAGE}' and leadgen_id = '${FAKE_LEADGEN_CONCURRENT}';`,
    ).trim();
    expect(count).toBe('1');
  });

  it('concorrência com leadgen distinto no mesmo lote: uma linha por leadgen', async () => {
    await Promise.all([
      register(FAKE_LEADGEN_CONCURRENT_EXTRA),
      register(FAKE_LEADGEN_CONCURRENT_EXTRA),
      register(FAKE_LEADGEN_CONCURRENT_EXTRA),
    ]);
    const count = sql(
      `select count(*) from public.meta_leadgen_events where page_id = '${FAKE_PAGE}' and leadgen_id = '${FAKE_LEADGEN_CONCURRENT_EXTRA}';`,
    ).trim();
    expect(count).toBe('1');
  });

  it('page sem conexão connected → register_failed, nenhuma linha criada', async () => {
    const result = await register(FAKE_LEADGEN, FAKE_PAGE_OTHER);
    expect(result).toEqual({ ok: false, code: 'register_failed' });
    const count = sql(
      `select count(*) from public.meta_leadgen_events where page_id = '${FAKE_PAGE_OTHER}';`,
    ).trim();
    expect(count).toBe('0');
  });

  it('form_id ausente é aceito como NULL', async () => {
    const result = await registerLeadgenEvent({
      integrationId,
      companyId,
      pageId: FAKE_PAGE,
      leadgenId: '940000000000010',
      formId: null,
      receivedAt: new Date(),
    });
    expect(result.ok).toBe(true);
    const formNull = sql(
      `select count(*) from public.meta_leadgen_events where leadgen_id = '940000000000010' and form_id is null;`,
    ).trim();
    expect(formNull).toBe('1');
  });
});
