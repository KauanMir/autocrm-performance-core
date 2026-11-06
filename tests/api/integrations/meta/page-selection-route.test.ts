// META-MVP2 — /api/integrations/meta/oauth/page-selection (GET lista, POST conecta).
// Auth, porta da seleção e conexão mockadas; nenhuma rede, nenhum banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedActor: vi.fn(),
  rpc: vi.fn(),
  list: vi.fn(),
  connect: vi.fn(),
  factoryFails: { value: false },
}));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...original, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});
vi.mock('@/lib/server/meta-oauth/connection-rpc', () => ({ createMetaConnectionRpcPort: () => ({}) }));
vi.mock('@/lib/server/meta-oauth/page-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/meta-oauth/page-selection')>();
  return {
    ...original,
    createPageSelectionRpc: () => {
      if (mocks.factoryFails.value) throw new Error('admin client mal configurado');
      return { list: mocks.list };
    },
    connectSelectedPage: mocks.connect,
  };
});

import { GET, POST } from '@/app/api/integrations/meta/oauth/page-selection/route';
import { createPageSelectionToken } from '@/lib/server/meta-oauth/page-selection';
import { PAGE_SELECTION_COOKIE_NAME, PAGE_SELECTION_COOKIE_PATH } from '@/lib/server/meta-oauth/cookie';

const SECRET_HEX = 'a'.repeat(64);
const SECRET = Buffer.from(SECRET_HEX, 'hex');
const APP_URL = 'https://crm.example.test';
const COMPANY = '66666666-6666-4666-8666-66666666666a';
const USER = '77777777-7777-4777-8777-777777777777';
const OTHER_USER = '77777777-7777-4777-8777-777777777778';
const SELECTION = '88888888-8888-4888-8888-888888888888';
const PAGE = '960000000000001';

const token = (userId = USER) => createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId });

const ROUTE = `${APP_URL}${PAGE_SELECTION_COOKIE_PATH}`;

function getRequest(t: string | null = token()): Request {
  return new Request(ROUTE, {
    headers: { Authorization: 'Bearer jwt', ...(t === null ? {} : { Cookie: `${PAGE_SELECTION_COOKIE_NAME}=${t}` }) },
  });
}

function postRequest(body: unknown, origin = APP_URL, t: string = token()): Request {
  return new Request(ROUTE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Authorization: 'Bearer jwt',
      Cookie: `${PAGE_SELECTION_COOKIE_NAME}=${t}`,
    },
    body: JSON.stringify(body),
  });
}

const clearsCookie = (res: Response) => (res.headers.get('set-cookie') ?? '').includes(`${PAGE_SELECTION_COOKIE_NAME}=;`);

beforeEach(() => {
  vi.stubEnv('META_OAUTH_STATE_SECRET', SECRET_HEX);
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('META_APP_ID', '1234567890123456');
  vi.stubEnv('META_APP_SECRET', 'fake-app-secret');
  vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ enabled: true }], error: null });
  mocks.requireAuthenticatedActor.mockReset().mockResolvedValue({ ok: true, actor: { profileId: USER }, client: { rpc: mocks.rpc }, jwt: 'jwt' });
  mocks.list.mockReset().mockResolvedValue([{ pageId: PAGE, pageName: 'Concessionária Centro' }]);
  mocks.connect.mockReset().mockResolvedValue({ ok: true, pageId: PAGE, pageName: 'Concessionária Centro' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET (lista)', () => {
  it('lista id e nome para o mesmo usuário com empresa habilitada', async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pages: [{ pageId: PAGE, pageName: 'Concessionária Centro' }] });
    expect(mocks.rpc).toHaveBeenCalledWith('meta_lead_ads_company_access', { p_company_id: COMPANY });
    expect(mocks.list).toHaveBeenCalledWith({ selectionId: SELECTION, companyId: COMPANY, profileId: USER });
  });

  it('token na URL é ignorado: sem o cookie → 400', async () => {
    const res = await GET(new Request(`${ROUTE}?token=${encodeURIComponent(token())}`, { headers: { Authorization: 'Bearer jwt' } }));
    expect(res.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('outro usuário com o cookie da seleção → 403 (a seleção é de quem iniciou o OAuth)', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: true, actor: { profileId: OTHER_USER }, client: { rpc: mocks.rpc }, jwt: 'jwt' });
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('empresa desabilitada → 403 company_access_disabled', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ enabled: false }], error: null });
    const res = await GET(getRequest());
    expect(await res.json()).toEqual({ ok: false, error: 'company_access_disabled' });
  });

  it('usuário sem permissão na empresa (RPC recusa) → 403', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    expect((await GET(getRequest())).status).toBe(403);
  });

  it('token inválido/adulterado → 400; sem sessão → 401', async () => {
    expect((await GET(getRequest('x.y'))).status).toBe(400);
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false, error: 'unauthenticated' });
    expect((await GET(getRequest())).status).toBe(401);
  });

  it('seleção consumida ou vencida (lista vazia) → 410 e o cookie é apagado', async () => {
    mocks.list.mockResolvedValue([]);
    const res = await GET(getRequest());
    expect(res.status).toBe(410);
    expect(clearsCookie(res)).toBe(true);
  });

  it('falha ao ler a seleção → 503, sem apagar o cookie', async () => {
    mocks.list.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(503);
    expect(clearsCookie(res)).toBe(false);
  });

  it('resposta nunca traz o token da seleção nem ciphertext', async () => {
    const t = token();
    const text = await (await GET(getRequest(t))).text();
    expect(text).not.toContain(t);
    expect(text).not.toContain('ciphertext');
  });

  it('persistência desligada → 403 sem tocar em nada', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    expect((await GET(getRequest())).status).toBe(403);
    expect(mocks.requireAuthenticatedActor).not.toHaveBeenCalled();
  });
});

describe('POST (conectar)', () => {
  it('conecta a Página escolhida com empresa e usuário DO TOKEN, nunca do corpo', async () => {
    const res = await POST(postRequest({ page_id: PAGE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, page: { id: PAGE, name: 'Concessionária Centro' } });
    expect(mocks.connect.mock.calls[0][1]).toEqual({ selectionId: SELECTION, companyId: COMPANY, userId: USER, pageId: PAGE });
    expect(clearsCookie(res)).toBe(true);
  });

  it.each([
    ['page_already_connected', 409],
    ['company_access_disabled', 409],
    ['selection_already_used', 410],
    ['selection_expired', 410],
    ['page_token_short_lived', 502],
    ['page_subscription_failed', 502],
  ])('erro %s → %d com o código fechado', async (error, status) => {
    mocks.connect.mockResolvedValue({ ok: false, error });
    const res = await POST(postRequest({ page_id: PAGE }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
  });

  it.each(['page_not_offered', 'page_already_connected', 'connection_lookup_failed'])(
    'erro %s antes de consumir mantém o cookie: o usuário pode escolher outra Página',
    async (error) => {
      mocks.connect.mockResolvedValue({ ok: false, error });
      expect(clearsCookie(await POST(postRequest({ page_id: PAGE })))).toBe(false);
    },
  );

  it.each(['selection_already_used', 'selection_expired', 'page_subscription_failed', 'connection_persist_failed'])(
    'erro %s com a seleção consumida apaga o cookie',
    async (error) => {
      mocks.connect.mockResolvedValue({ ok: false, error });
      expect(clearsCookie(await POST(postRequest({ page_id: PAGE })))).toBe(true);
    },
  );

  it('inscrita na Meta sem conexão gravada: sinal operacional no log, sem IDs, e cookie apagado', async () => {
    mocks.connect.mockResolvedValue({ ok: false, error: 'page_already_connected', subscribedWithoutConnection: true });
    const res = await POST(postRequest({ page_id: PAGE }));
    expect(clearsCookie(res)).toBe(true);
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logged).toContain('subscribed_without_connection');
    expect(logged).not.toContain(PAGE);
    expect(logged).not.toContain(COMPANY);
  });

  it('Origin divergente → 403 antes de autenticar', async () => {
    const res = await POST(postRequest({ page_id: PAGE }, 'https://evil.test'));
    expect(res.status).toBe(403);
    expect(mocks.requireAuthenticatedActor).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ page_id: 'abc' }],
    [{ page_id: PAGE, company_id: COMPANY }],
    [{ page_id: PAGE, selection_token: token() }],
  ])('corpo inválido %j → 400 (empresa e seleção nunca vêm do corpo)', async (body) => {
    expect((await POST(postRequest(body))).status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('token de outro usuário → 403, nada conectado', async () => {
    const res = await POST(postRequest({ page_id: PAGE }, APP_URL, token(OTHER_USER)));
    expect(res.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('cliente admin indisponível → 500 fechado, sem vazar detalhe', async () => {
    mocks.factoryFails.value = true;
    const post = await POST(postRequest({ page_id: PAGE }));
    const get = await GET(getRequest());
    mocks.factoryFails.value = false;
    expect(post.status).toBe(500);
    expect(await post.json()).toEqual({ ok: false, error: 'server_misconfigured' });
    expect(get.status).toBe(500);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('sem cookie → 400, nada conectado', async () => {
    const res = await POST(new Request(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP_URL, Authorization: 'Bearer jwt' },
      body: JSON.stringify({ page_id: PAGE }),
    }));
    expect(res.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
