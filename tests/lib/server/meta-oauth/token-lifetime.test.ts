// META-MVP1 — troca por token de longa duração e debug_token. fetch fake;
// nenhum token real.
import { describe, expect, it, vi } from 'vitest';
import {
  evaluatePageToken,
  exchangeForLongLivedUserToken,
  inspectAccessToken,
  MIN_PAGE_TOKEN_LIFETIME_MS,
} from '@/lib/server/meta-oauth/token-lifetime';

const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret-not-real';
const USER_TOKEN = 'FAKE-SHORT-USER-TOKEN';
const PAGE_TOKEN = 'FAKE-PAGE-TOKEN';
const NOW = new Date('2026-11-05T12:00:00.000Z');

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('exchangeForLongLivedUserToken', () => {
  const run = (fetchImpl: typeof fetch) =>
    exchangeForLongLivedUserToken({ userAccessToken: USER_TOKEN, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: 'v26.0', fetchImpl });

  it('GET /oauth/access_token com grant_type=fb_exchange_token e os 4 parâmetros da doc', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, { access_token: 'LONG', expires_in: 5183944 }));
    expect(await run(fetchImpl)).toEqual({ ok: true, accessToken: 'LONG', expiresInSeconds: 5183944, httpStatus: 200 });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v26.0/oauth/access_token');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      grant_type: 'fb_exchange_token',
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: USER_TOKEN,
    });
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
  });

  it.each([
    ['4xx', () => json(400, { error: { message: 'secret detail' } }), 'http_4xx'],
    ['5xx', () => json(500, {}), 'http_5xx'],
    ['sem access_token', () => json(200, { token_type: 'bearer' }), 'invalid_body'],
    ['JSON inválido', () => new Response('nope', { status: 200 }), 'invalid_json'],
  ])('%s → falha classificada, sem corpo da Meta', async (_label, respond, reason) => {
    const { fetchImpl } = fakeFetch(respond);
    const result = await run(fetchImpl);
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain('secret detail');
  });

  it('timeout e rede viram timeout / network_error, sem propagar a URL', async () => {
    const abort = fakeFetch(() => { throw Object.assign(new Error(`aborted ${APP_SECRET}`), { name: 'AbortError' }); });
    expect(await run(abort.fetchImpl)).toEqual({ ok: false, reason: 'timeout' });
    const net = fakeFetch(() => { throw new TypeError(`fetch failed ${APP_SECRET}`); });
    const result = await run(net.fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'network_error' });
    expect(JSON.stringify(result)).not.toContain(APP_SECRET);
  });

  it('versão inválida nunca faz request', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, {}));
    const result = await exchangeForLongLivedUserToken({ userAccessToken: USER_TOKEN, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: '../x', fetchImpl });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('inspectAccessToken (debug_token)', () => {
  const run = (fetchImpl: typeof fetch) =>
    inspectAccessToken({ inputToken: PAGE_TOKEN, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: 'v26.0', fetchImpl });

  it('token de app só no header; input_token na query; segredo nunca na URL', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, { data: { app_id: APP_ID, type: 'PAGE', is_valid: true, expires_at: 0 } }));
    await run(fetchImpl);
    const { url, init } = calls[0];
    expect(url.pathname).toBe('/v26.0/debug_token');
    expect(Object.fromEntries(url.searchParams)).toEqual({ input_token: PAGE_TOKEN });
    expect(url.toString()).not.toContain(APP_SECRET);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${APP_ID}|${APP_SECRET}`);
  });

  it('expires_at 0 ou ausente = sem expiração informada (null)', async () => {
    const { fetchImpl } = fakeFetch(() => json(200, { data: { app_id: APP_ID, type: 'PAGE', is_valid: true, expires_at: 0 } }));
    expect(await run(fetchImpl)).toEqual({
      ok: true,
      httpStatus: 200,
      inspection: { isValid: true, type: 'PAGE', appIdMatches: true, profileId: null, expiresAt: null, dataAccessExpiresAt: null },
    });
  });

  it('corpo sem data → invalid_body', async () => {
    const { fetchImpl } = fakeFetch(() => json(200, { nope: true }));
    expect(await run(fetchImpl)).toMatchObject({ ok: false, reason: 'invalid_body' });
  });
});

describe('evaluatePageToken', () => {
  const PAGE_ID = '1381033925087695';
  const base = { isValid: true, type: 'PAGE' as string | null, appIdMatches: true, profileId: null as string | null, expiresAt: null as number | null, dataAccessExpiresAt: null as number | null };
  const inSeconds = (ms: number) => Math.floor((NOW.getTime() + ms) / 1000);

  it('token de Página válido sem expiração → ok com datas null', () => {
    expect(evaluatePageToken(base, NOW, PAGE_ID)).toEqual({ ok: true, expiresAt: null, dataAccessExpiresAt: null });
  });

  it('expiração acima de 7 dias → ok e devolve as datas', () => {
    const r = evaluatePageToken({ ...base, expiresAt: inSeconds(MIN_PAGE_TOKEN_LIFETIME_MS + 3600_000), dataAccessExpiresAt: inSeconds(90 * 86400_000) }, NOW, PAGE_ID);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['inválido', { isValid: false }, 'page_token_invalid'],
    ['de outro app', { appIdMatches: false }, 'page_token_invalid'],
    ['tipo USER', { type: 'USER' }, 'page_token_invalid'],
    ['profile_id de outra Página', { profileId: '999' }, 'page_token_invalid'],
    ['expira em 2 horas (curta duração)', { expiresAt: inSeconds(2 * 3600_000) }, 'page_token_short_lived'],
    ['expira em 6 dias', { expiresAt: inSeconds(6 * 86400_000) }, 'page_token_short_lived'],
    ['acesso a dados já vencido', { dataAccessExpiresAt: inSeconds(-1000) }, 'page_token_invalid'],
  ])('%s → %s', (_label, override, reason) => {
    expect(evaluatePageToken({ ...base, ...override }, NOW, PAGE_ID)).toEqual({ ok: false, reason });
  });
});

describe('META-MVP1 — não rejeitar token válido', () => {
  const PAGE_ID = '1381033925087695';
  const valid = { isValid: true, appIdMatches: true, expiresAt: null, dataAccessExpiresAt: null };

  it('type ausente (não consta na referência oficial) é aceito', () => {
    expect(evaluatePageToken({ ...valid, type: null, profileId: null }, NOW, PAGE_ID).ok).toBe(true);
  });

  it('profile_id da Página escolhida é aceito', () => {
    expect(evaluatePageToken({ ...valid, type: 'PAGE', profileId: PAGE_ID }, NOW, PAGE_ID).ok).toBe(true);
  });

  it('sem expiração e sem expiração de acesso a dados: aceito com datas null', () => {
    expect(evaluatePageToken({ ...valid, type: 'PAGE', profileId: null }, NOW, PAGE_ID)).toEqual({
      ok: true, expiresAt: null, dataAccessExpiresAt: null,
    });
  });

  it('expiração de 60 dias (token de usuário longo) é aceita', () => {
    const in60d = Math.floor((NOW.getTime() + 60 * 86400_000) / 1000);
    expect(evaluatePageToken({ ...valid, type: 'PAGE', profileId: null, expiresAt: in60d }, NOW, PAGE_ID).ok).toBe(true);
  });

  it('debug_token lê profile_id da resposta', async () => {
    const { fetchImpl } = fakeFetch(() => json(200, { data: { app_id: APP_ID, is_valid: true, profile_id: PAGE_ID } }));
    const r = await inspectAccessToken({ inputToken: PAGE_TOKEN, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: 'v26.0', fetchImpl });
    expect(r).toMatchObject({ ok: true, inspection: { type: null, profileId: PAGE_ID } });
  });
});
