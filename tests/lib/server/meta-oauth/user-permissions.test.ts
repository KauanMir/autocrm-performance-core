// META-P3.5 — leitura de permissões concedidas (GET /me/permissions), paginação
// por cursor e verificação das quatro permissões obrigatórias do Lead Ads.
// Tokens fake; nenhuma rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGrantedUserPermissions,
  findMissingRequiredPermission,
  MAX_PERMISSION_PAGES,
  REQUIRED_LEAD_ADS_PERMISSIONS,
} from '@/lib/server/meta-oauth/user-permissions';

const FAKE_SUAT = 'FAKE-SUAT-user-permissions-test-only';
const FAKE_CURSOR_1 = 'FAKE-CURSOR-page-1';
const FAKE_CURSOR_2 = 'FAKE-CURSOR-page-2';
const VERSION = 'v26.0';
const ENDPOINT = `https://graph.facebook.com/${VERSION}/me/permissions`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function page(
  entries: Array<{ permission: string; status: string }>,
  paging?: { hasNext: true; cursor: string } | { hasNext: false },
): Response {
  const body: Record<string, unknown> = { data: entries };
  if (paging?.hasNext) {
    body.paging = { cursors: { before: 'FAKE-BEFORE', after: paging.cursor }, next: 'https://evil.example.test/next' };
  } else if (paging) {
    body.paging = { cursors: { before: 'FAKE-BEFORE', after: 'FAKE-AFTER-LAST' } };
  }
  return jsonResponse(body);
}

function granted(...names: string[]): Array<{ permission: string; status: string }> {
  return names.map((permission) => ({ permission, status: 'granted' }));
}

const ALL_FOUR = [...REQUIRED_LEAD_ADS_PERMISSIONS];

// Fetch que devolve respostas em sequência e registra as URLs chamadas.
function sequenceFetch(responses: Response[]): { fn: typeof fetch; urls: URL[] } {
  const urls: URL[] = [];
  let index = 0;
  const fn = (async (input: unknown) => {
    urls.push(new URL(String(input)));
    const template = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return template.clone();
  }) as unknown as typeof fetch;
  return { fn, urls };
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchGrantedUserPermissions — uma página e parsing', () => {
  it('uma página: chama GET /{version}/me/permissions com o SUAT e devolve só as concedidas', async () => {
    const { fn, urls } = sequenceFetch([
      page([
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'leads_retrieval', status: 'granted' },
        { permission: 'pages_read_engagement', status: 'declined' },
        { permission: 'pages_manage_metadata', status: 'expired' },
      ]),
    ]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: true, grantedPermissions: ['pages_show_list', 'leads_retrieval'] });
    expect(urls).toHaveLength(1);
    expect(`${urls[0].origin}${urls[0].pathname}`).toBe(ENDPOINT);
    expect(urls[0].searchParams.get('limit')).toBe('100');
    expect(urls[0].searchParams.get('access_token')).toBe(FAKE_SUAT);
    expect(urls[0].searchParams.has('after')).toBe(false);
  });

  it('itens malformados são ignorados (não contam como concedidos)', async () => {
    const { fn } = sequenceFetch([jsonResponse({ data: [null, 'leads_retrieval', { permission: 42, status: 'granted' }, { status: 'granted' }] })]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: true, grantedPermissions: [] });
  });

  it('data vazio sem paginação é sucesso com nenhuma concedida', async () => {
    const { fn } = sequenceFetch([jsonResponse({ data: [] })]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: true, grantedPermissions: [] });
  });
});

describe('fetchGrantedUserPermissions — paginação por cursor', () => {
  it('duas páginas: permissão necessária só na segunda é encontrada; 2ª chamada usa after=<cursor> no mesmo endpoint', async () => {
    const { fn, urls } = sequenceFetch([
      page(granted('pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'), { hasNext: true, cursor: FAKE_CURSOR_1 }),
      page(granted('leads_retrieval'), { hasNext: false }),
    ]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({
      ok: true,
      grantedPermissions: ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
    });
    expect(urls).toHaveLength(2);
    expect(`${urls[1].origin}${urls[1].pathname}`).toBe(ENDPOINT);
    expect(urls[1].searchParams.get('after')).toBe(FAKE_CURSOR_1);
    expect(urls[1].searchParams.get('access_token')).toBe(FAKE_SUAT);
  });

  it('paging.next nunca é seguido: nenhuma chamada ao host indicado em next', async () => {
    const { fn, urls } = sequenceFetch([
      page(granted(...ALL_FOUR), { hasNext: true, cursor: FAKE_CURSOR_1 }),
      page([], { hasNext: false }),
    ]);
    await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(urls.every((u) => u.hostname === 'graph.facebook.com')).toBe(true);
  });

  it('declined em uma página não conta como granted, mesmo que apareça como granted em outra página', async () => {
    const { fn } = sequenceFetch([
      page([{ permission: 'leads_retrieval', status: 'declined' }], { hasNext: true, cursor: FAKE_CURSOR_1 }),
      page(granted('pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'), { hasNext: false }),
    ]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result.ok && result.grantedPermissions.includes('leads_retrieval')).toBe(false);
    expect(findMissingRequiredPermission(result.ok ? result.grantedPermissions : [])).toBe('leads_retrieval');
  });

  it('paginação termina normalmente quando a última página não indica próxima', async () => {
    const { fn, urls } = sequenceFetch([
      page(granted('pages_show_list'), { hasNext: true, cursor: FAKE_CURSOR_1 }),
      page(granted('pages_read_engagement'), { hasNext: true, cursor: FAKE_CURSOR_2 }),
      page(granted('pages_manage_metadata', 'leads_retrieval'), { hasNext: false }),
    ]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(urls).toHaveLength(3);
    expect(urls[2].searchParams.get('after')).toBe(FAKE_CURSOR_2);
    expect(findMissingRequiredPermission(result.ok ? result.grantedPermissions : ['x'])).toBeNull();
  });

  it(`excedeu o limite de ${MAX_PERMISSION_PAGES} páginas -> pagination_limit_exceeded (nunca missing), exatamente ${MAX_PERMISSION_PAGES} chamadas`, async () => {
    const { fn, urls } = sequenceFetch([page(granted('pages_show_list'), { hasNext: true, cursor: FAKE_CURSOR_1 })]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'pagination_limit_exceeded' });
    expect(urls).toHaveLength(MAX_PERMISSION_PAGES);
  });

  it('indica próxima página mas sem cursor after -> invalid_response (fail closed)', async () => {
    const noCursor = jsonResponse({ data: granted('pages_show_list'), paging: { next: 'https://evil.example.test/x' } });
    const { fn, urls } = sequenceFetch([noCursor]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'invalid_response', httpStatus: 200 });
    expect(urls).toHaveLength(1);
  });

  it('falha HTTP na segunda página é propagada como falha (não como missing)', async () => {
    const { fn } = sequenceFetch([
      page(granted(...ALL_FOUR), { hasNext: true, cursor: FAKE_CURSOR_1 }),
      new Response('', { status: 500 }),
    ]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'http_5xx', httpStatus: 500 });
  });
});

describe('fetchGrantedUserPermissions — falhas sanitizadas', () => {
  it('HTTP 4xx -> http_4xx sem corpo da Meta', async () => {
    const { fn } = sequenceFetch([jsonResponse({ error: { message: `token ${FAKE_SUAT}` } }, 400)]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'http_4xx', httpStatus: 400 });
    expect(JSON.stringify(result)).not.toContain(FAKE_SUAT);
  });

  it('timeout (AbortError) -> timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fn = (async () => { throw abort; }) as unknown as typeof fetch;
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('erro de rede -> network_error, sem a mensagem bruta (que contém o token)', async () => {
    const fn = (async () => { throw new Error(`socket reset for ${FAKE_SUAT}`); }) as unknown as typeof fetch;
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'network_error' });
    expect(JSON.stringify(result)).not.toContain(FAKE_SUAT);
  });

  it('corpo não-JSON -> invalid_response', async () => {
    const { fn } = sequenceFetch([new Response('<html>', { status: 200 })]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'invalid_response', httpStatus: 200 });
  });

  it('data que não é array -> invalid_response', async () => {
    const { fn } = sequenceFetch([jsonResponse({ data: { permission: 'leads_retrieval' } })]);
    const result = await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: fn });
    expect(result).toEqual({ ok: false, reason: 'invalid_response', httpStatus: 200 });
  });

  it('nenhum log em sucesso, paginação ou falha', async () => {
    const ok = sequenceFetch([page(granted(...ALL_FOUR), { hasNext: true, cursor: FAKE_CURSOR_1 }), page([], { hasNext: false })]);
    await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: ok.fn });
    const over = sequenceFetch([page(granted('pages_show_list'), { hasNext: true, cursor: FAKE_CURSOR_1 })]);
    await fetchGrantedUserPermissions({ userAccessToken: FAKE_SUAT, graphApiVersion: VERSION, fetchImpl: over.fn });
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('findMissingRequiredPermission — as quatro são obrigatórias', () => {
  it('lista define exatamente as quatro permissões de Lead Ads', () => {
    expect([...REQUIRED_LEAD_ADS_PERMISSIONS].sort()).toEqual(
      ['leads_retrieval', 'pages_manage_metadata', 'pages_read_engagement', 'pages_show_list'],
    );
  });

  it('quatro presentes -> null', () => {
    expect(findMissingRequiredPermission(ALL_FOUR)).toBeNull();
  });

  it.each(REQUIRED_LEAD_ADS_PERMISSIONS)('%s ausente -> essa permissão é reportada', (missing) => {
    expect(findMissingRequiredPermission(ALL_FOUR.filter((p) => p !== missing))).toBe(missing);
  });

  it('permissões extras não causam falha', () => {
    expect(findMissingRequiredPermission([...ALL_FOUR, 'ads_management', 'pages_messaging'])).toBeNull();
  });

  it('nenhuma concedida -> primeira obrigatória da ordem fixa', () => {
    expect(findMissingRequiredPermission([])).toBe('pages_show_list');
  });
});
