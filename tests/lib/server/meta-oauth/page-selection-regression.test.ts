// META-MVP2 — reposição da cobertura de segurança dos testes do fluxo antigo
// (oauth-callback-page-subscription/-persistence/-review-ui), que exercitavam a
// Página fixa dentro do callback. A verificação da Página agora mora em
// connectSelectedPage: os mesmos cenários rodam aqui, na nova arquitetura.
// Graph via fetch FAKE; portas fakes; nenhuma rede, nenhum banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSelectedPage, type PageSelectionRpc } from '@/lib/server/meta-oauth/page-selection';
import { decryptMetaPageToken, encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import type { MetaConnectionRpcPort, UpsertRpcArgs } from '@/lib/server/meta-oauth/connection-persistence';
import { debugTokenResponse } from '@/tests/helpers/metaGraphFakes';

const KEY_HEX = 'd'.repeat(64);
const KEY = Buffer.from(KEY_HEX, 'hex');
const COMPANY = '33333333-3333-4333-8333-33333333333a';
const OTHER_COMPANY = '33333333-3333-4333-8333-33333333333b';
const USER = '44444444-4444-4444-8444-444444444444';
const SELECTION = '55555555-5555-4555-8555-555555555555';
const PAGE = '960000000000001';
const PAGE_TOKEN = 'FAKE-SELECTED-PAGE-TOKEN-never-leak';
const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-never-leak';
const NOW = new Date('2026-11-05T12:00:00.000Z');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const timeoutError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
type Responder = () => Response;

describe('verificação da Página escolhida', () => {
  let upserts: UpsertRpcArgs[];
  let upsertImpl: (args: UpsertRpcArgs) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  let requests: { url: URL; init?: RequestInit }[];
  let debug: Responder;
  let posts: Responder;
  let subscribe: Responder;

  const paths = () => requests.map((r) => r.url.pathname);
  const subscribeCalls = () => requests.filter((r) => r.url.pathname.endsWith('/subscribed_apps'));

  function deps() {
    const selection: PageSelectionRpc = {
      leadAdsEnabled: vi.fn(async () => true),
      create: vi.fn(async () => null),
      list: vi.fn(async () => [{ pageId: PAGE, pageName: 'Concessionária Centro' }]),
      consume: vi.fn(async () => ({
        outcome: 'consumed' as const,
        pageName: 'Concessionária Centro',
        tokenOrigin: 'exchanged_long_lived' as const,
        ciphertext: encryptMetaPageToken({ plaintextToken: PAGE_TOKEN, companyId: COMPANY, pageId: PAGE, key: KEY }),
      })),
    };
    const connection = {
      upsert: vi.fn(async (args: UpsertRpcArgs) => {
        upserts.push(args);
        return upsertImpl(args);
      }),
      ownerByPage: vi.fn(async () => ({ data: [], error: null })),
      ownerForIngestion: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as MetaConnectionRpcPort;
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname.endsWith('/debug_token')) return debug();
      if (url.pathname.endsWith('/posts')) return posts();
      if (url.pathname.endsWith('/subscribed_apps')) return subscribe();
      throw new Error('unexpected');
    }) as unknown as typeof fetch;
    return { selection, connection, fetchImpl, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: 'v26.0', now: () => NOW };
  }

  const input = { selectionId: SELECTION, companyId: COMPANY, userId: USER, pageId: PAGE };
  const connect = () => connectSelectedPage(deps(), input);

  beforeEach(() => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_HEX);
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    upserts = [];
    requests = [];
    upsertImpl = async () => ({
      data: [{ id: 'i1', company_id: COMPANY, page_id: PAGE, page_name: 'P', status: 'connected', connected_at: null, leadgen_subscribed_at: null }],
      error: null,
    });
    debug = () => debugTokenResponse(APP_ID, { profile_id: PAGE });
    posts = () => json({ data: [] });
    subscribe = () => json({ success: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  describe('debug_token', () => {
    it.each([
      ['inválido', { is_valid: false }, 'page_token_invalid'],
      ['de outro app', { app_id: '999' }, 'page_token_invalid'],
      ['que não é de Página', { type: 'USER' }, 'page_token_invalid'],
      ['de outra Página', { profile_id: '999' }, 'page_token_invalid'],
      ['que expira em 1 dia', { expires_at: Math.floor(NOW.getTime() / 1000) + 86400 }, 'page_token_short_lived'],
      ['com acesso a dados vencido', { data_access_expires_at: Math.floor(NOW.getTime() / 1000) - 60 }, 'page_token_invalid'],
    ])('token %s → %s, nunca lê a Página, nunca inscreve, nunca persiste', async (_label, overrides, error) => {
      debug = () => debugTokenResponse(APP_ID, { profile_id: PAGE, ...overrides });
      expect(await connect()).toEqual({ ok: false, error });
      expect(paths().some((p) => p.endsWith('/posts'))).toBe(false);
      expect(subscribeCalls()).toHaveLength(0);
      expect(upserts).toHaveLength(0);
    });

    it('debug_token sem `type` (campo fora da referência oficial) é aceito', async () => {
      debug = () => json({ data: { app_id: APP_ID, is_valid: true, expires_at: 0, data_access_expires_at: 0, profile_id: PAGE } });
      expect((await connect()).ok).toBe(true);
    });

    it('o token de app vai só no header, nunca na URL', async () => {
      await connect();
      const call = requests.find((r) => r.url.pathname.endsWith('/debug_token'));
      expect(call?.url.toString()).not.toContain(APP_SECRET);
      expect(JSON.stringify(call?.init?.headers)).toContain(APP_SECRET);
      expect(call?.url.searchParams.get('input_token')).toBe(PAGE_TOKEN);
    });
  });

  describe('leitura da Página (pages_read_engagement)', () => {
    it.each([
      ['4xx', () => json({}, 403)],
      ['5xx', () => json({}, 500)],
      ['corpo sem data', () => json({ outro: true })],
    ])('%s → page_read_engagement_failed, nunca inscreve', async (_label, response) => {
      posts = response;
      expect(await connect()).toEqual({ ok: false, error: 'page_read_engagement_failed' });
      expect(subscribeCalls()).toHaveLength(0);
      expect(upserts).toHaveLength(0);
    });

    it('timeout → page_read_engagement_failed, nunca inscreve', async () => {
      posts = () => { throw timeoutError(); };
      expect(await connect()).toEqual({ ok: false, error: 'page_read_engagement_failed' });
      expect(subscribeCalls()).toHaveLength(0);
    });

    it('Página sem posts é sucesso', async () => {
      posts = () => json({ data: [] });
      expect((await connect()).ok).toBe(true);
    });

    it('endpoint e parâmetros exatos: só id, limite 1, GET', async () => {
      await connect();
      const call = requests.find((r) => r.url.pathname.endsWith('/posts'));
      expect(call?.url.pathname).toBe(`/v26.0/${PAGE}/posts`);
      expect(call?.url.searchParams.get('fields')).toBe('id');
      expect(call?.url.searchParams.get('limit')).toBe('1');
      expect((call?.init?.method ?? 'GET').toUpperCase()).toBe('GET');
    });
  });

  describe('inscrição no webhook', () => {
    it('leitura vem antes da inscrição, e a inscrição antes de persistir', async () => {
      await connect();
      expect(paths()).toEqual(['/v26.0/debug_token', `/v26.0/${PAGE}/posts`, `/v26.0/${PAGE}/subscribed_apps`]);
      expect(upserts).toHaveLength(1);
    });

    it('endpoint exato, POST, campo exatamente "leadgen"', async () => {
      await connect();
      const [call] = subscribeCalls();
      expect(call.url.pathname).toBe(`/v26.0/${PAGE}/subscribed_apps`);
      expect(call.init?.method).toBe('POST');
      expect(call.url.searchParams.get('subscribed_fields')).toBe('leadgen');
    });

    it.each([
      ['4xx', () => json({}, 400)],
      ['5xx', () => json({}, 500)],
      ['success:false', () => json({ success: false })],
    ])('%s → page_subscription_failed, nada persistido', async (_label, response) => {
      subscribe = response;
      expect(await connect()).toEqual({ ok: false, error: 'page_subscription_failed' });
      expect(upserts).toHaveLength(0);
    });

    it('timeout → page_subscription_failed, nada persistido', async () => {
      subscribe = () => { throw timeoutError(); };
      expect(await connect()).toEqual({ ok: false, error: 'page_subscription_failed' });
      expect(upserts).toHaveLength(0);
    });

    it('no máximo uma chamada de cada tipo, mesmo em falha', async () => {
      subscribe = () => json({}, 500);
      await connect();
      for (const suffix of ['/debug_token', '/posts', '/subscribed_apps']) {
        expect(paths().filter((p) => p.endsWith(suffix))).toHaveLength(1);
      }
    });
  });

  describe('persistência', () => {
    it('grava empresa, Página, nome, quatro permissões, autor, datas e versão da chave', async () => {
      await connect();
      expect(upserts[0]).toMatchObject({
        p_company_id: COMPANY,
        p_page_id: PAGE,
        p_page_name: 'Concessionária Centro',
        p_connected_by: USER,
        p_token_key_version: 1,
        p_connected_at: NOW.toISOString(),
        p_leadgen_subscribed_at: NOW.toISOString(),
      });
      expect([...upserts[0].p_granted_scopes].sort()).toEqual(['leads_retrieval', 'pages_manage_metadata', 'pages_read_engagement', 'pages_show_list']);
    });

    it('token em claro nunca chega à RPC; o ciphertext só decifra com a mesma empresa e Página', async () => {
      await connect();
      expect(JSON.stringify(upserts[0])).not.toContain(PAGE_TOKEN);
      const ciphertext = upserts[0].p_access_token_ciphertext;
      expect(decryptMetaPageToken({ ciphertext, companyId: COMPANY, pageId: PAGE, key: KEY })).toBe(PAGE_TOKEN);
      expect(() => decryptMetaPageToken({ ciphertext, companyId: OTHER_COMPANY, pageId: PAGE, key: KEY })).toThrow();
      expect(() => decryptMetaPageToken({ ciphertext, companyId: COMPANY, pageId: '960000000000002', key: KEY })).toThrow();
    });

    it('erro de transporte: no máximo duas tentativas e nenhum cancelamento da inscrição', async () => {
      upsertImpl = async () => { throw new Error('rede'); };
      expect(await connect()).toEqual({ ok: false, error: 'connection_persist_failed', subscribedWithoutConnection: true });
      expect(upserts).toHaveLength(2);
      expect(subscribeCalls()).toHaveLength(1);
      expect(requests.some((r) => (r.init?.method ?? '').toUpperCase() === 'DELETE')).toBe(false);
    });

    it('erro semântico não é repetido', async () => {
      upsertImpl = async () => ({ data: null, error: { message: 'invalid_input' } });
      await connect();
      expect(upserts).toHaveLength(1);
    });

    it('chave de cifragem ausente no servidor: nada é chamado na Meta', async () => {
      vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
      expect(await connect()).toEqual({ ok: false, error: 'token_decrypt_failed' });
      expect(requests).toHaveLength(0);
    });
  });

  describe('sigilo', () => {
    it('nem resultado nem log carregam token, segredo ou Page ID', async () => {
      const logged: string[] = [];
      for (const method of ['log', 'error', 'warn'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
      }
      const success = await connect();
      subscribe = () => json({}, 500);
      const failure = await connect();
      const surfaces = [JSON.stringify(failure), ...logged];
      for (const secret of [PAGE_TOKEN, APP_SECRET]) {
        for (const surface of surfaces) expect(surface).not.toContain(secret);
      }
      expect(JSON.stringify(success)).not.toContain(PAGE_TOKEN);
      for (const line of logged) expect(line).not.toContain(PAGE);
    });
  });
});
