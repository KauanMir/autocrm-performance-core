// @vitest-environment node
// META-P4B.5 — integração LOCAL real contra o Supabase local (PostgREST +
// Postgres). Só roda com META_P4B5_LOCAL=1 e variáveis do stack local
// injetadas pelo runner (nunca gravadas no repositório). Tokens, chaves,
// emails e IDs são fake. Nenhum endpoint remoto, nenhuma Meta, nenhum OAuth.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import {
  findMetaConnectionOwnerByPage,
  persistMetaPageConnection,
  type UpsertRpcArgs,
} from '@/lib/server/meta-oauth/connection-persistence';
import { decryptMetaPageToken, encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';

const RUN = process.env.META_P4B5_LOCAL === '1';
const CONTAINER = 'supabase_db_autocrm-performance-core';
const FAKE_KEY_HEX = 'cd'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-TOKEN-p4b5-local-only';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const PAGE_ADAPTER = '910000000000001';
const PAGE_SERVICE = '910000000000002';
const PAGE_NONE = '910000000000999';

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA'], {
    input: statement,
    encoding: 'utf8',
  });
}

describe.runIf(RUN)('META-P4B.5 — integração local real', () => {
  let admin: ReturnType<typeof createAdminClient>;
  const suffix = randomBytes(4).toString('hex');
  let companyA = '';
  let companyB = '';
  let userId = '';

  beforeAll(async () => {
    admin = createAdminClient();
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');

    const a = await admin.from('companies').insert({ name: `P4B5 Fixture A ${suffix}` }).select('id').single();
    const b = await admin.from('companies').insert({ name: `P4B5 Fixture B ${suffix}` }).select('id').single();
    if (a.error || b.error || !a.data || !b.data) throw new Error('fixture_company_failed');
    companyA = a.data.id;
    companyB = b.data.id;

    const email = `p4b5-${suffix}@test.local`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('fixture_user_failed');
    userId = created.data.user.id;

    const profile = await admin
      .from('profiles')
      .upsert({ id: userId, name: 'P4B5 Fixture', email, is_active: true }, { onConflict: 'id' });
    if (profile.error) throw new Error(`fixture_profile_failed: ${profile.error.message}`);
  });

  afterAll(async () => {
    try {
      sql(
        `delete from public.audit_log where action = 'meta_connection_upserted' and company_id in ('${companyA}', '${companyB}');\n` +
          `delete from public.company_meta_integrations where company_id in ('${companyA}', '${companyB}');\n` +
          `delete from public.companies where id in ('${companyA}', '${companyB}');\n` +
          `delete from auth.users where id = '${userId}';\n`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  function upsertArgs(overrides: Partial<UpsertRpcArgs> = {}): UpsertRpcArgs {
    return {
      p_company_id: companyA,
      p_page_id: PAGE_ADAPTER,
      p_page_name: 'Pagina P4B5 Fake A',
      p_access_token_ciphertext: encryptMetaPageToken({
        plaintextToken: FAKE_PAGE_TOKEN,
        companyId: companyA,
        pageId: PAGE_ADAPTER,
        key: FAKE_KEY,
      }),
      p_token_key_version: 1,
      p_granted_scopes: [...REQUIRED],
      p_connected_at: new Date('2026-10-05T12:00:00.000Z').toISOString(),
      p_connected_by: userId,
      p_leadgen_subscribed_at: new Date('2026-10-05T12:00:01.000Z').toISOString(),
      ...overrides,
    };
  }

  it('A. owner lookup de page inexistente: nenhum owner', async () => {
    const port = createMetaConnectionRpcPort();
    const result = await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: () => true }, PAGE_NONE);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('B. upsert pelo adapter real cria a conexão connected', async () => {
    const port = createMetaConnectionRpcPort();
    const result = await port.upsert(upsertArgs());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].company_id).toBe(companyA);
    expect(result.data?.[0].status).toBe('connected');
    expect(result.data?.[0].page_id).toBe(PAGE_ADAPTER);
  });

  it('C. owner lookup depois do upsert retorna a company correta', async () => {
    const port = createMetaConnectionRpcPort();
    const result = await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: () => true }, PAGE_ADAPTER);
    expect(result.ok && result.value?.companyId).toBe(companyA);
    expect(result.ok && result.value?.status).toBe('connected');
  });

  it('D. reconectar a mesma company/page atualiza a mesma linha sem duplicar', async () => {
    const port = createMetaConnectionRpcPort();
    const before = await port.upsert(upsertArgs());
    const again = await port.upsert(upsertArgs({ p_page_name: 'Pagina P4B5 Fake A (reconectada)' }));
    expect(again.error).toBeNull();
    expect(again.data?.[0].id).toBe(before.data?.[0].id);
    const status = await admin.rpc('meta_connection_status', { p_company_id: companyA });
    const rows = (status.data ?? []).filter((r) => r.page_id === PAGE_ADAPTER);
    expect(rows).toHaveLength(1);
    expect(rows[0].page_name).toBe('Pagina P4B5 Fake A (reconectada)');
  });

  it('E. segunda company na mesma page connected: page_already_connected sanitizado', async () => {
    const port = createMetaConnectionRpcPort();
    const raw = await port.upsert(upsertArgs({ p_company_id: companyB }));
    expect(raw.data).toBeNull();
    expect(raw.error?.message).toBe('page_already_connected');

    const sanitized = await persistMetaPageConnection(
      { rpc: port },
      {
        companyId: companyB,
        pageId: PAGE_ADAPTER,
        pageName: 'Pagina P4B5 Fake A',
        pageAccessToken: FAKE_PAGE_TOKEN,
        grantedScopes: REQUIRED,
        connectedAt: new Date(),
        connectedBy: userId,
        leadgenSubscribedAt: new Date(),
      },
    );
    expect(sanitized).toEqual({ ok: false, code: 'page_already_connected' });
    expect(JSON.stringify(sanitized)).not.toMatch(/DETAIL|violates|P0001|SQL/);
    const bStatus = await admin.rpc('meta_connection_status', { p_company_id: companyB });
    expect(bStatus.data ?? []).toHaveLength(0);
  });

  it('F. a tabela continua sem acesso direto (service_role e anon) — nenhum grant alterado', async () => {
    const adminRead = await admin.from('company_meta_integrations').select('id');
    expect(adminRead.error).not.toBeNull();
    expect(adminRead.data).toBeNull();

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonRead = await anon.from('company_meta_integrations').select('id');
    expect(anonRead.error).not.toBeNull();
    expect(anonRead.data).toBeNull();

    const adminWrite = await admin.from('company_meta_integrations').insert({
      company_id: companyA,
      page_id: '910000000000777',
      status: 'disconnected',
    });
    expect(adminWrite.error).not.toBeNull();
  });

  it('G. persistMetaPageConnection real: plaintext fake -> encrypt -> RPC real -> linha connected', async () => {
    const port = createMetaConnectionRpcPort();
    const result = await persistMetaPageConnection(
      { rpc: port },
      {
        companyId: companyA,
        pageId: PAGE_SERVICE,
        pageName: 'Pagina P4B5 Fake Service',
        pageAccessToken: FAKE_PAGE_TOKEN,
        grantedScopes: REQUIRED,
        connectedAt: new Date(),
        connectedBy: userId,
        leadgenSubscribedAt: new Date(),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.status).toBe('connected');
    expect(JSON.stringify(result)).not.toContain(FAKE_PAGE_TOKEN);

    const status = await admin.rpc('meta_connection_status', { p_company_id: companyA });
    const row = (status.data ?? []).find((r) => r.page_id === PAGE_SERVICE);
    expect(row?.status).toBe('connected');
    expect(row?.granted_scopes.sort()).toEqual([...REQUIRED].sort());
  });

  it('H/I. (somente teste) lookup_by_page: ciphertext v1, != plaintext, key version 1, round-trip com chave fake', async () => {
    const lookup = await admin.rpc('meta_connection_lookup_by_page', { p_page_id: PAGE_SERVICE });
    expect(lookup.error).toBeNull();
    const row = lookup.data?.[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.access_token_ciphertext.startsWith('v1.')).toBe(true);
    expect(row.access_token_ciphertext).not.toBe(FAKE_PAGE_TOKEN);
    expect(JSON.stringify(lookup.data)).not.toContain(FAKE_PAGE_TOKEN);
    expect(row.token_key_version).toBe(1);
    expect(row.company_id).toBe(companyA);
    const decrypted = decryptMetaPageToken({
      ciphertext: row.access_token_ciphertext,
      companyId: companyA,
      pageId: PAGE_SERVICE,
      key: FAKE_KEY,
    });
    expect(decrypted).toBe(FAKE_PAGE_TOKEN);
  });

  it('J. flag OFF no serviço real: persistence_disabled, nenhuma linha nova', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    const port = createMetaConnectionRpcPort();
    const result = await persistMetaPageConnection(
      { rpc: port },
      {
        companyId: companyB,
        pageId: '910000000000555',
        pageName: 'Pagina P4B5 Off',
        pageAccessToken: FAKE_PAGE_TOKEN,
        grantedScopes: REQUIRED,
        connectedAt: new Date(),
        connectedBy: userId,
        leadgenSubscribedAt: new Date(),
      },
    );
    expect(result).toEqual({ ok: false, code: 'persistence_disabled' });
    const bStatus = await admin.rpc('meta_connection_status', { p_company_id: companyB });
    expect(bStatus.data ?? []).toHaveLength(0);
  });
});
