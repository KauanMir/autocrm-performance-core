// META-MVP2 — callback OAuth multiempresa: empresa autorizada → token de longa
// duração → permissões → Páginas elegíveis → seleção CIFRADA de uso único →
// cookie HttpOnly com o token assinado. Graph via fetch FAKE; porta da seleção FAKE.
// Substitui os testes do fluxo antigo (Página de teste fixa inscrita e
// persistida dentro do callback), que deixou de existir.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOAuthState, OAUTH_STATE_FLOW_REVIEW_UI } from '@/lib/server/meta-oauth/state';
import { BINDING_COOKIE_NAME, PAGE_SELECTION_COOKIE_NAME, PAGE_SELECTION_COOKIE_PATH, readPageSelectionCookie } from '@/lib/server/meta-oauth/cookie';
import { decryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import { isLongLivedExchangeUrl } from '@/tests/helpers/metaGraphFakes';

const fake = vi.hoisted(() => ({
  enabled: { value: true as boolean | null },
  created: [] as { companyId: string; profileId: string; pages: { page_id: string; page_name: string; ciphertext: string }[]; tokenOrigin: string }[],
  createResult: { value: 'aaaaaaaa-0000-4000-8000-000000000001' as string | null },
  factoryCalls: { count: 0 },
  throwOnFactory: { value: false },
}));

vi.mock('@/lib/server/meta-oauth/page-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/meta-oauth/page-selection')>();
  return {
    ...original,
    createPageSelectionRpc: () => {
      if (fake.throwOnFactory.value) throw new Error('admin client mal configurado');
      fake.factoryCalls.count += 1;
      return {
        leadAdsEnabled: async () => fake.enabled.value,
        create: async (input: (typeof fake.created)[number]) => {
          fake.created.push(input);
          return fake.createResult.value;
        },
        list: async () => [],
        consume: async () => null,
      };
    },
  };
});

import { GET } from '@/app/api/integrations/meta/oauth/callback/route';
import { verifyPageSelectionToken } from '@/lib/server/meta-oauth/page-selection';

const STATE_SECRET_HEX = 'a'.repeat(64);
const SECRET_BUF = Buffer.from(STATE_SECRET_HEX, 'hex');
const KEY_HEX = 'b'.repeat(64);
const APP_URL = 'https://crm.assessoriakapa.com.br';
const ENDPOINT = `${APP_URL}/api/integrations/meta/oauth/callback`;
const GRAPH_VERSION = 'v26.0';
const FAKE_CODE = 'AQ' + 'x'.repeat(60);
const BINDING = 'test-binding-value-not-a-secret-000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_A = '22222222-2222-4222-8222-22222222222a';
const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real-000000000000';
const FAKE_USER_TOKEN = 'FAKE-USER-TOKEN-must-never-leak-000';
const LONG_LIVED = 'FAKE-LONG-LIVED-USER-TOKEN-never-leak';
const PAGE_1_TOKEN = 'FAKE-PAGE-1-TOKEN-must-never-leak';
const PAGE_2_TOKEN = 'FAKE-PAGE-2-TOKEN-must-never-leak';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];

let fetchMock: ReturnType<typeof vi.spyOn>;
let accounts: unknown[];
let exchangeBody: Record<string, unknown>;
let permissions: string[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const urlOf = (arg: unknown) => (arg instanceof URL ? arg : new URL(String(arg)));

function request(flow?: 'review_ui'): Request {
  const state = createOAuthState({
    secret: SECRET_BUF,
    binding: BINDING,
    userId: USER_ID,
    companyId: COMPANY_A,
    ...(flow ? { flow: OAUTH_STATE_FLOW_REVIEW_UI } : {}),
  });
  const url = new URL(ENDPOINT);
  url.searchParams.set('code', FAKE_CODE);
  url.searchParams.set('state', state);
  return new Request(url, { method: 'GET', headers: { cookie: `${BINDING_COOKIE_NAME}=${BINDING}` } });
}

const callsTo = (suffix: string) => fetchMock.mock.calls.map((c) => urlOf(c[0])).filter((u) => u.pathname.endsWith(suffix));

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', STATE_SECRET_HEX);
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_GRAPH_API_VERSION', GRAPH_VERSION);
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
  vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_HEX);
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  fake.enabled.value = true;
  fake.created.length = 0;
  fake.createResult.value = 'aaaaaaaa-0000-4000-8000-000000000001';
  fake.factoryCalls.count = 0;
  exchangeBody = { access_token: FAKE_USER_TOKEN, token_type: 'bearer', expires_in: 5183944 };
  permissions = [...REQUIRED];
  accounts = [
    { id: '960000000000001', name: 'Concessionária Centro', access_token: PAGE_1_TOKEN, tasks: ['ADVERTISE', 'MANAGE'] },
    { id: '960000000000002', name: 'Concessionária Sul', access_token: PAGE_2_TOKEN, tasks: ['ADVERTISE'] },
    { id: '960000000000003', name: 'Sem ADVERTISE', access_token: 'x', tasks: ['MODERATE'] },
  ];
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const u = urlOf(input);
    if (isLongLivedExchangeUrl(u)) return json({ access_token: LONG_LIVED, expires_in: 5183944 });
    if (u.pathname.endsWith('/oauth/access_token')) return json(exchangeBody);
    if (u.pathname.endsWith('/me/permissions')) return json({ data: permissions.map((permission) => ({ permission, status: 'granted' })) });
    if (u.pathname.endsWith('/me/accounts')) return json({ data: accounts });
    throw new Error(`unexpected fetch in test: ${u.pathname}`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('autorização da empresa', () => {
  it('empresa DESABILITADA → token_exchange_verified, nenhuma Página consultada, nenhuma seleção', async () => {
    fake.enabled.value = false;
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe('token_exchange_verified');
    expect(callsTo('/me/accounts')).toHaveLength(0);
    expect(callsTo('/me/permissions')).toHaveLength(0);
    expect(fake.created).toHaveLength(0);
  });

  it('leitura da habilitação falhou (null) → tratada como desabilitada (fail closed)', async () => {
    fake.enabled.value = null;
    const res = await GET(request());
    expect((await res.json()).stage).toBe('token_exchange_verified');
    expect(fake.created).toHaveLength(0);
  });

  it('persistência desligada → nem consulta o banco', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    const res = await GET(request());
    expect((await res.json()).stage).toBe('token_exchange_verified');
    expect(fake.factoryCalls.count).toBe(0);
  });
});

describe('Páginas elegíveis e seleção cifrada', () => {
  it('cria UMA seleção só com Páginas que têm ADVERTISE, tokens cifrados com AAD da empresa+Página', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(fake.created).toHaveLength(1);
    const [selection] = fake.created;
    expect(selection.companyId).toBe(COMPANY_A);
    expect(selection.profileId).toBe(USER_ID);
    expect(selection.tokenOrigin).toBe('exchanged_long_lived');
    expect(selection.pages.map((p) => p.page_id)).toEqual(['960000000000001', '960000000000002']);
    const key = Buffer.from(KEY_HEX, 'hex');
    expect(decryptMetaPageToken({ ciphertext: selection.pages[0].ciphertext, companyId: COMPANY_A, pageId: '960000000000001', key })).toBe(PAGE_1_TOKEN);
    // AAD: o ciphertext de uma Página não abre como outra Página nem outra empresa.
    expect(() => decryptMetaPageToken({ ciphertext: selection.pages[0].ciphertext, companyId: COMPANY_A, pageId: '960000000000002', key })).toThrow();
    expect(() => decryptMetaPageToken({ ciphertext: selection.pages[0].ciphertext, companyId: USER_ID, pageId: '960000000000001', key })).toThrow();
    // /me/accounts com o token de longa duração.
    expect(callsTo('/me/accounts')[0].searchParams.get('access_token')).toBe(LONG_LIVED);
  });

  const cookiesOf = (res: Response) => res.headers.getSetCookie();
  const selectionCookie = (res: Response) => cookiesOf(res).find((c) => c.startsWith(`${PAGE_SELECTION_COOKIE_NAME}=`)) ?? '';

  it('fluxo da UI → 302 para /company/<empresa>?meta_select=1; o token assinado vai só no cookie HttpOnly', async () => {
    const res = await GET(request('review_ui'));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${APP_URL}/company/${COMPANY_A}`);
    expect([...location.searchParams.entries()]).toEqual([['meta_select', '1']]);

    const cookie = selectionCookie(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=${PAGE_SELECTION_COOKIE_PATH}`);
    expect(cookie).toContain('Max-Age=600');
    const verified = verifyPageSelectionToken(readPageSelectionCookie(cookie.split(';')[0]), { secret: SECRET_BUF });
    expect(verified).toEqual({ ok: true, selectionId: 'aaaaaaaa-0000-4000-8000-000000000001', companyId: COMPANY_A, userId: USER_ID });
    expect(cookiesOf(res).some((c) => c.startsWith(`${BINDING_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
  });

  it('em produção o cookie da seleção é Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(selectionCookie(await GET(request('review_ui')))).toContain('Secure');
  });

  it('sem fluxo da UI → JSON page_selection_required com contagem, sem o token no corpo', async () => {
    const res = await GET(request());
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, stage: 'page_selection_required', selection: { pageCount: 2, truncated: false } });
    const token = readPageSelectionCookie(selectionCookie(res).split(';')[0]);
    expect(token).toBeTruthy();
    expect(text).not.toContain(token as string);
    expect(JSON.parse(text).selection).not.toHaveProperty('token');
  });

  it('flag de Integrações desligada no callback → nunca 302, mesmo com o fluxo da UI no state', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    expect((await GET(request('review_ui'))).status).toBe(200);
  });

  it('nenhuma Página elegível → 502 no_eligible_page, nenhuma seleção', async () => {
    accounts = [{ id: '960000000000003', name: 'Sem ADVERTISE', access_token: 'x', tasks: ['MODERATE'] }];
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'no_eligible_page' });
    expect(fake.created).toHaveLength(0);
  });

  it('falha ao gravar a seleção → 502 page_selection_unavailable', async () => {
    fake.createResult.value = null;
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: false, error: 'page_selection_unavailable' });
  });

  it('permissão faltando → 403 missing_required_permission, nenhuma Página consultada', async () => {
    permissions = REQUIRED.slice(0, 3);
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(callsTo('/me/accounts')).toHaveLength(0);
    expect(fake.created).toHaveLength(0);
  });

  it('troca sem expires_in → origem original_token, sem fb_exchange_token', async () => {
    exchangeBody = { access_token: FAKE_USER_TOKEN };
    await GET(request());
    expect(fake.created[0].tokenOrigin).toBe('original_token');
    expect(fetchMock.mock.calls.map((c) => urlOf(c[0])).filter(isLongLivedExchangeUrl)).toHaveLength(0);
  });

  it('o callback NUNCA inscreve Página, verifica token de Página ou persiste conexão', async () => {
    await GET(request('review_ui'));
    expect(callsTo('/subscribed_apps')).toHaveLength(0);
    expect(callsTo('/debug_token')).toHaveLength(0);
    expect(callsTo('/posts')).toHaveLength(0);
  });

  it('nenhum token, segredo ou code aparece em resposta, redirect ou log', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    const ui = await GET(request('review_ui'));
    const plain = await GET(request());
    const surfaces = [ui.headers.get('location') ?? '', await plain.text(), ...logs];
    for (const secret of [FAKE_USER_TOKEN, LONG_LIVED, PAGE_1_TOKEN, PAGE_2_TOKEN, APP_SECRET, FAKE_CODE]) {
      for (const surface of surfaces) expect(surface).not.toContain(secret);
    }
  });
});

// Reposição da cobertura do fluxo antigo, na nova arquitetura.
describe('regressão de segurança do callback', () => {
  const selectionCookieOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${PAGE_SELECTION_COOKIE_NAME}=`));
  const clearsBinding = (res: Response) => res.headers.getSetCookie().some((c) => c.startsWith(`${BINDING_COOKIE_NAME}=;`) && c.includes('Max-Age=0'));

  function overrideGraph(handler: (u: URL) => Response | null) {
    const base = fetchMock.getMockImplementation() as (input: unknown) => Promise<Response>;
    fetchMock.mockImplementation(async (input: unknown) => handler(urlOf(input)) ?? base(input));
  }

  it('state adulterado ou binding errado → nenhuma chamada à Graph e nenhuma seleção', async () => {
    const tampered = new URL(request().url);
    tampered.searchParams.set('state', 'x.y');
    await GET(new Request(tampered, { headers: { cookie: `${BINDING_COOKIE_NAME}=${BINDING}` } }));
    await GET(new Request(request().url, { headers: { cookie: `${BINDING_COOKIE_NAME}=outro-binding` } }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.created).toHaveLength(0);
  });

  it('troca do code falha → sem /me/accounts, sem seleção, binding limpo', async () => {
    overrideGraph((u) => (u.pathname.endsWith('/oauth/access_token') ? json({}, 400) : null));
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(callsTo('/me/accounts')).toHaveLength(0);
    expect(fake.created).toHaveLength(0);
    expect(clearsBinding(res)).toBe(true);
  });

  it.each([
    ['4xx', () => json({ error: { message: 'detalhe da Meta' } }, 400)],
    ['5xx', () => json({ error: { message: 'detalhe da Meta' } }, 500)],
  ])('/me/accounts %s → page_token_lookup_failed sanitizado, sem seleção', async (_label, response) => {
    overrideGraph((u) => (u.pathname.endsWith('/me/accounts') ? response() : null));
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(await res.text()).toBe(JSON.stringify({ ok: false, error: 'page_token_lookup_failed' }));
    expect(fake.created).toHaveLength(0);
    expect(selectionCookieOf(res)).toBeUndefined();
    expect(clearsBinding(res)).toBe(true);
  });

  it('/me/accounts timeout → page_token_lookup_failed', async () => {
    const base = fetchMock.getMockImplementation() as (input: unknown) => Promise<Response>;
    fetchMock.mockImplementation(async (input: unknown) => {
      if (urlOf(input).pathname.endsWith('/me/accounts')) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return base(input);
    });
    expect(await (await GET(request())).json()).toEqual({ ok: false, error: 'page_token_lookup_failed' });
  });

  it('chave de cifragem ausente → token_encryption_failed, nenhuma seleção gravada', async () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'token_encryption_failed' });
    expect(fake.created).toHaveLength(0);
  });

  it('nenhum token em claro chega à gravação da seleção', async () => {
    await GET(request());
    const stored = JSON.stringify(fake.created);
    for (const secret of [FAKE_USER_TOKEN, LONG_LIVED, PAGE_1_TOKEN, PAGE_2_TOKEN]) expect(stored).not.toContain(secret);
  });

  it('o ciphertext da seleção não decifra para outra Página', async () => {
    await GET(request());
    const key = Buffer.from(KEY_HEX, 'hex');
    const [first] = fake.created[0].pages;
    expect(decryptMetaPageToken({ ciphertext: first.ciphertext, companyId: COMPANY_A, pageId: first.page_id, key })).toBe(PAGE_1_TOKEN);
    expect(() => decryptMetaPageToken({ ciphertext: first.ciphertext, companyId: COMPANY_A, pageId: '960000000000002', key })).toThrow();
  });

  it.each(REQUIRED)('permissão %s faltando → 403 com o nome, sem /me/accounts', async (permission) => {
    permissions = REQUIRED.filter((p) => p !== permission);
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'missing_required_permission', permission });
    expect(callsTo('/me/accounts')).toHaveLength(0);
    expect(clearsBinding(res)).toBe(true);
  });

  it('permissão com status declined conta como ausente', async () => {
    overrideGraph((u) => (u.pathname.endsWith('/me/permissions')
      ? json({ data: REQUIRED.map((permission, i) => ({ permission, status: i === 0 ? 'declined' : 'granted' })) })
      : null));
    expect((await GET(request())).status).toBe(403);
  });

  it('permissões extras não causam falha', async () => {
    permissions = [...REQUIRED, 'email', 'public_profile'];
    expect((await GET(request('review_ui'))).status).toBe(302);
  });

  it('falha em /me/permissions → 502 sanitizado, sem /me/accounts', async () => {
    overrideGraph((u) => (u.pathname.endsWith('/me/permissions') ? json({ error: { message: 'detalhe' } }, 500) : null));
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: false, error: 'user_permissions_lookup_failed' });
    expect(callsTo('/me/accounts')).toHaveLength(0);
  });

  it('paginação de /me/permissions excedida → incompleto, não "permissão faltando"', async () => {
    overrideGraph((u) => (u.pathname.endsWith('/me/permissions')
      ? json({ data: [{ permission: 'pages_show_list', status: 'granted' }], paging: { next: 'https://evil.example.test/n', cursors: { after: 'FAKE-CURSOR' } } })
      : null));
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'user_permissions_lookup_incomplete' });
    expect(callsTo('/me/accounts')).toHaveLength(0);
  });

  it('falha ao trocar por token de longa duração NÃO recusa: segue com o original', async () => {
    overrideGraph((u) => (isLongLivedExchangeUrl(u) ? json({}, 400) : null));
    await GET(request());
    expect(fake.created[0].tokenOrigin).toBe('original_token');
    expect(callsTo('/me/accounts')[0].searchParams.get('access_token')).toBe(FAKE_USER_TOKEN);
  });

  it('/me/accounts é chamado uma vez só por callback', async () => {
    await GET(request());
    expect(callsTo('/me/accounts')).toHaveLength(1);
  });

  it('nenhum Page ID, empresa ou usuário aparece nos logs', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    await GET(request('review_ui'));
    for (const id of ['960000000000001', '960000000000002', COMPANY_A, USER_ID]) expect(logs.join(' ')).not.toContain(id);
  });

  describe('fluxo da UI: falha volta para a tela, nunca JSON cru', () => {
    const errorOf = (res: Response) => new URL(res.headers.get('location') ?? '').searchParams.get('meta_error');

    it('sem Página elegível → 302 para a empresa com meta_error', async () => {
      accounts = [];
      const res = await GET(request('review_ui'));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('location') ?? '').pathname).toBe(`/company/${COMPANY_A}`);
      expect(errorOf(res)).toBe('no_eligible_page');
      expect(clearsBinding(res)).toBe(true);
      expect(selectionCookieOf(res)).toBeUndefined();
    });

    it('usuário cancelou na Meta → 302 com provider_error; o texto da Meta não é refletido', async () => {
      const url = new URL(request('review_ui').url);
      url.searchParams.delete('code');
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', '<script>alert(1)</script>');
      const res = await GET(new Request(url, { headers: { cookie: `${BINDING_COOKIE_NAME}=${BINDING}` } }));
      expect(res.status).toBe(302);
      expect(errorOf(res)).toBe('provider_error');
      expect(res.headers.get('location')).not.toContain('script');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('permissão faltando → 302 sem o nome da permissão na URL', async () => {
      permissions = REQUIRED.slice(1);
      const res = await GET(request('review_ui'));
      expect(errorOf(res)).toBe('missing_required_permission');
      expect(res.headers.get('location')).not.toContain(REQUIRED[0]);
    });

    it('empresa desligada durante o OAuth → 302 com company_access_disabled', async () => {
      fake.enabled.value = false;
      expect(errorOf(await GET(request('review_ui')))).toBe('company_access_disabled');
    });

    it('state inválido nunca redireciona: sem prova de origem, a resposta é o erro seco', async () => {
      const tampered = new URL(request('review_ui').url);
      tampered.searchParams.set('state', 'x.y');
      const res = await GET(new Request(tampered, { headers: { cookie: `${BINDING_COOKIE_NAME}=${BINDING}` } }));
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });

    it('sem o fluxo da UI a resposta continua JSON', async () => {
      accounts = [];
      const res = await GET(request());
      expect(res.status).toBe(502);
      expect(res.headers.get('location')).toBeNull();
    });
  });

  it('falha ao criar a porta da seleção → 500 sem vazar detalhe', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    fake.throwOnFactory.value = true;
    const res = await GET(request());
    fake.throwOnFactory.value = false;
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server_misconfigured' });
  });
});
