// META-MVP2 — seleção de Página: token assinado, Páginas elegíveis e conexão da
// Página escolhida. Graph via fetch FAKE; portas fake; nenhum banco, nenhuma rede.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectSelectedPage,
  createPageSelectionToken,
  fetchEligiblePages,
  verifyPageSelectionToken,
  type PageSelectionRpc,
} from '@/lib/server/meta-oauth/page-selection';
import { createOAuthState, verifyOAuthState } from '@/lib/server/meta-oauth/state';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import type { MetaConnectionRpcPort, UpsertRpcArgs } from '@/lib/server/meta-oauth/connection-persistence';
import { debugTokenResponse } from '@/tests/helpers/metaGraphFakes';

const SECRET = Buffer.from('c'.repeat(64), 'hex');
const KEY_HEX = 'd'.repeat(64);
const KEY = Buffer.from(KEY_HEX, 'hex');
const COMPANY = '33333333-3333-4333-8333-33333333333a';
const OTHER_COMPANY = '33333333-3333-4333-8333-33333333333b';
const USER = '44444444-4444-4444-8444-444444444444';
const SELECTION = '55555555-5555-4555-8555-555555555555';
const PAGE = '960000000000001';
const PAGE_TOKEN = 'FAKE-SELECTED-PAGE-TOKEN';
const APP_ID = '1234567890123456';
const APP_SECRET = 'fake-app-secret';
const NOW = new Date('2026-11-05T12:00:00.000Z');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('token da seleção', () => {
  it('ida e volta com empresa, usuário e seleção', () => {
    const token = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER });
    expect(verifyPageSelectionToken(token, { secret: SECRET })).toEqual({ ok: true, selectionId: SELECTION, companyId: COMPANY, userId: USER });
  });

  it('adulterado, de outro segredo, vencido ou malformado → recusado', () => {
    const token = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER });
    const [body, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), cid: OTHER_COMPANY })).toString('base64url');
    expect(verifyPageSelectionToken(`${tamperedBody}.${sig}`, { secret: SECRET })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyPageSelectionToken(token, { secret: Buffer.from('e'.repeat(64), 'hex') })).toEqual({ ok: false, reason: 'invalid' });
    const old = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER, nowMs: NOW.getTime() - 3600_000 });
    expect(verifyPageSelectionToken(old, { secret: SECRET, nowMs: NOW.getTime() })).toEqual({ ok: false, reason: 'expired' });
    for (const bad of [null, '', 'abc', 'a.b.c', 'x'.repeat(2000)]) {
      expect(verifyPageSelectionToken(bad, { secret: SECRET }).ok).toBe(false);
    }
  });

  it('TTL nunca passa de 10 minutos', () => {
    const token = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER, ttlSeconds: 99999, nowMs: NOW.getTime() });
    expect(verifyPageSelectionToken(token, { secret: SECRET, nowMs: NOW.getTime() + 9 * 60_000 }).ok).toBe(true);
    expect(verifyPageSelectionToken(token, { secret: SECRET, nowMs: NOW.getTime() + 10 * 60_000 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('state do OAuth não vale como token de seleção, mesmo assinado com o mesmo segredo', () => {
    const state = createOAuthState({ secret: SECRET, binding: 'b'.repeat(43), userId: USER, companyId: COMPANY });
    expect(verifyPageSelectionToken(state, { secret: SECRET }).ok).toBe(false);
  });

  it('o token da seleção não vale como state do OAuth', () => {
    const token = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER });
    expect(verifyOAuthState(token, { secret: SECRET, expectedBinding: 'b'.repeat(43) }).ok).toBe(false);
  });

  it('troca de empresa ou usuário no corpo invalida a assinatura', () => {
    const token = createPageSelectionToken({ secret: SECRET, selectionId: SELECTION, companyId: COMPANY, userId: USER });
    const [body, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    for (const swap of [{ cid: OTHER_COMPANY }, { uid: OTHER_COMPANY }, { sid: OTHER_COMPANY }]) {
      const forged = Buffer.from(JSON.stringify({ ...payload, ...swap }), 'utf8').toString('base64url');
      expect(verifyPageSelectionToken(`${forged}.${signature}`, { secret: SECRET })).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});

describe('fetchEligiblePages', () => {
  it('pede exatamente id, name, access_token e tasks, com o token do usuário', async () => {
    let seen: URL | null = null;
    const fetchImpl = (async (input: unknown) => {
      seen = new URL(String(input));
      return json({ data: [] });
    }) as unknown as typeof fetch;
    await fetchEligiblePages({ accessToken: 'USER-TOKEN', graphApiVersion: 'v26.0', fetchImpl });
    const url = seen as unknown as URL;
    expect(url.pathname).toBe('/v26.0/me/accounts');
    expect(url.searchParams.get('fields')).toBe('id,name,access_token,tasks');
    expect(url.searchParams.get('access_token')).toBe('USER-TOKEN');
  });

  it('só Páginas com ADVERTISE, token e id numérico; sem repetição; nome padrão quando vazio', async () => {
    const fetchImpl = vi.fn(async () => json({
      data: [
        { id: '1', name: 'A', access_token: 't1', tasks: ['ADVERTISE'] },
        { id: '1', name: 'A dup', access_token: 't1', tasks: ['ADVERTISE'] },
        { id: '2', name: '', access_token: 't2', tasks: ['ADVERTISE'] },
        { id: '3', name: 'Sem task', access_token: 't3', tasks: ['MODERATE'] },
        { id: '4', name: 'Sem token', tasks: ['ADVERTISE'] },
        { id: 'abc', name: 'Id ruim', access_token: 't5', tasks: ['ADVERTISE'] },
      ],
    })) as unknown as typeof fetch;
    const r = await fetchEligiblePages({ accessToken: 'u', graphApiVersion: 'v26.0', fetchImpl });
    expect(r).toMatchObject({ ok: true, ineligibleCount: 3, truncated: false });
    expect('pages' in r && r.pages.map((p) => [p.pageId, p.pageName])).toEqual([['1', 'A'], ['2', 'Página 2']]);
  });

  it('paginação além da primeira página → truncated', async () => {
    const fetchImpl = vi.fn(async () => json({ data: [], paging: { next: 'https://x' } })) as unknown as typeof fetch;
    expect(await fetchEligiblePages({ accessToken: 'u', graphApiVersion: 'v26.0', fetchImpl })).toMatchObject({ ok: true, truncated: true });
  });

  it('erro HTTP não lê o corpo e não vaza', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { message: 'secret detail' } }, 400)) as unknown as typeof fetch;
    const r = await fetchEligiblePages({ accessToken: 'u', graphApiVersion: 'v26.0', fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'http_4xx', httpStatus: 400 });
  });
});

describe('connectSelectedPage', () => {
  let upserts: UpsertRpcArgs[];
  let owner: { company_id: string; status?: string } | null;
  let ownerError: { code?: string } | null;
  let ownerThrows: boolean;
  let upsertError: { code?: string; message?: string } | null;
  let consumeResult: Awaited<ReturnType<PageSelectionRpc['consume']>>;
  let enabled: boolean | null;
  let calls: string[];
  let debug: () => Response;
  let subscribe: () => Response;

  const ciphertext = () => encryptMetaPageToken({ plaintextToken: PAGE_TOKEN, companyId: COMPANY, pageId: PAGE, key: KEY });

  function makeDeps() {
    const selection: PageSelectionRpc = {
      leadAdsEnabled: vi.fn(async () => enabled),
      create: vi.fn(async () => null),
      list: vi.fn(async () => []),
      consume: vi.fn(async () => consumeResult),
    };
    const connection: MetaConnectionRpcPort = {
      upsert: vi.fn(async (args: UpsertRpcArgs) => {
        upserts.push(args);
        if (upsertError) return { data: null, error: upsertError };
        return { data: [{ id: 'i1', company_id: COMPANY, page_id: PAGE, page_name: 'P', status: 'connected', connected_at: null, leadgen_subscribed_at: null }], error: null };
      }),
      ownerByPage: vi.fn(async () => ({ data: [], error: null })),
      ownerForIngestion: vi.fn(async () => {
        if (ownerThrows) throw new Error('transport');
        if (ownerError) return { data: null, error: ownerError };
        return { data: owner ? [{ integration_id: 'x', company_id: owner.company_id, page_id: PAGE, status: owner.status ?? 'connected' }] : [], error: null };
      }),
    };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const u = new URL(String(input));
      calls.push(u.pathname);
      if (u.pathname.endsWith('/debug_token')) return debug();
      if (u.pathname.endsWith('/posts')) return json({ data: [] });
      if (u.pathname.endsWith('/subscribed_apps')) return subscribe();
      throw new Error('unexpected');
    }) as unknown as typeof fetch;
    return { selection, connection, fetchImpl, appId: APP_ID, appSecret: APP_SECRET, graphApiVersion: 'v26.0', now: () => NOW };
  }

  const input = { selectionId: SELECTION, companyId: COMPANY, userId: USER, pageId: PAGE };

  beforeEach(() => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_HEX);
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    upserts = [];
    owner = null;
    ownerError = null;
    ownerThrows = false;
    upsertError = null;
    enabled = true;
    calls = [];
    consumeResult = { outcome: 'consumed', pageName: 'Concessionária Centro', ciphertext: ciphertext(), tokenOrigin: 'exchanged_long_lived' };
    debug = () => debugTokenResponse(APP_ID, { profile_id: PAGE });
    subscribe = () => json({ success: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('sucesso: debug_token → leitura → inscrição leadgen → persistência com validade e autor', async () => {
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: true, pageId: PAGE, pageName: 'Concessionária Centro' });
    expect(calls).toEqual(['/v26.0/debug_token', `/v26.0/${PAGE}/posts`, `/v26.0/${PAGE}/subscribed_apps`]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      p_company_id: COMPANY, p_page_id: PAGE, p_page_name: 'Concessionária Centro', p_connected_by: USER,
      p_token_origin: 'exchanged_long_lived', p_token_expires_at: null,
    });
    expect(JSON.stringify(upserts[0])).not.toContain(PAGE_TOKEN);
  });

  it('empresa desabilitada → company_access_disabled, sem consumir nem chamar a Meta', async () => {
    enabled = false;
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'company_access_disabled' });
    expect(deps.selection.consume).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('Página já conectada a OUTRA empresa → recusa ANTES de consumir (o usuário pode escolher outra)', async () => {
    owner = { company_id: OTHER_COMPANY };
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'page_already_connected' });
    expect(deps.selection.consume).not.toHaveBeenCalled();
  });

  it('Página de OUTRA empresa em ERRO também é recusada: a dona está reconectando, os leads não mudam de empresa', async () => {
    owner = { company_id: OTHER_COMPANY, status: 'error' };
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'page_already_connected' });
    expect(deps.selection.consume).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('conexão em erro da própria empresa é reconexão válida', async () => {
    owner = { company_id: COMPANY, status: 'error' };
    expect((await connectSelectedPage(makeDeps(), input)).ok).toBe(true);
  });

  it.each([
    ['erro do banco', () => { ownerError = { code: 'XX' }; }],
    ['transporte', () => { ownerThrows = true; }],
  ])('falha ao conferir o dono (%s) → connection_lookup_failed, sem consumir nem chamar a Meta', async (_label, arrange) => {
    arrange();
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'connection_lookup_failed' });
    expect(deps.selection.consume).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('Página fora da seleção é recusada ANTES de olhar o dono: não dá para sondar Páginas de outras empresas', async () => {
    owner = { company_id: OTHER_COMPANY };
    const deps = makeDeps();
    deps.selection.list = vi.fn(async () => [{ pageId: '960000000000099', pageName: 'Outra' }]);
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'page_not_offered' });
    expect(deps.connection.ownerForIngestion).not.toHaveBeenCalled();
    expect(deps.selection.consume).not.toHaveBeenCalled();
  });

  it('reconexão da mesma empresa é aceita', async () => {
    owner = { company_id: COMPANY };
    expect((await connectSelectedPage(makeDeps(), input)).ok).toBe(true);
  });

  it.each([
    ['already_consumed', 'selection_already_used'],
    ['expired', 'selection_expired'],
    ['not_found', 'selection_unavailable'],
    ['page_not_offered', 'page_not_offered'],
  ] as const)('seleção %s → %s, sem Meta', async (outcome, error) => {
    consumeResult = { outcome };
    expect(await connectSelectedPage(makeDeps(), input)).toEqual({ ok: false, error });
    expect(calls).toHaveLength(0);
  });

  it('ciphertext de outra empresa (AAD) → token_decrypt_failed', async () => {
    consumeResult = {
      outcome: 'consumed', pageName: 'P', tokenOrigin: 'original_token',
      ciphertext: encryptMetaPageToken({ plaintextToken: PAGE_TOKEN, companyId: OTHER_COMPANY, pageId: PAGE, key: KEY }),
    };
    expect(await connectSelectedPage(makeDeps(), input)).toEqual({ ok: false, error: 'token_decrypt_failed' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['token que vence em horas', () => debugTokenResponse(APP_ID, { expires_at: Math.floor(NOW.getTime() / 1000) + 3600 }), 'page_token_short_lived'],
    ['token de outra Página', () => debugTokenResponse(APP_ID, { profile_id: '999' }), 'page_token_invalid'],
    ['debug_token indisponível', () => json({}, 500), 'page_token_inspection_failed'],
  ])('%s → %s, nunca inscreve nem persiste', async (_label, response, error) => {
    debug = response;
    expect(await connectSelectedPage(makeDeps(), input)).toEqual({ ok: false, error });
    expect(calls.some((c) => c.endsWith('/subscribed_apps'))).toBe(false);
    expect(upserts).toHaveLength(0);
  });

  it('inscrição recusada pela Meta → page_subscription_failed, nada persistido', async () => {
    subscribe = () => json({}, 400);
    expect(await connectSelectedPage(makeDeps(), input)).toEqual({ ok: false, error: 'page_subscription_failed' });
    expect(upserts).toHaveLength(0);
  });

  it('leitura da habilitação falhou (null) → tratada como desabilitada (fail closed)', async () => {
    enabled = null;
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, input)).toEqual({ ok: false, error: 'company_access_disabled' });
    expect(deps.selection.consume).not.toHaveBeenCalled();
  });

  it('corrida: outra empresa gravou primeiro → page_already_connected, com sinal de inscrição sem conexão e sem cancelar a inscrição', async () => {
    upsertError = { message: 'page_already_connected' };
    expect(await connectSelectedPage(makeDeps(), input)).toEqual({ ok: false, error: 'page_already_connected', subscribedWithoutConnection: true });
    expect(calls.filter((c) => c.endsWith('/subscribed_apps'))).toHaveLength(1);
  });

  it('falha ao gravar depois de inscrever → connection_persist_failed com sinal, sem cancelar a inscrição', async () => {
    upsertError = { code: 'XX', message: 'erro bruto do banco com detalhe sensível' };
    const result = await connectSelectedPage(makeDeps(), input);
    expect(result).toEqual({ ok: false, error: 'connection_persist_failed', subscribedWithoutConnection: true });
    expect(JSON.stringify(result)).not.toContain('sensível');
  });

  it('page_id inválido → page_not_offered sem tocar em nada', async () => {
    const deps = makeDeps();
    expect(await connectSelectedPage(deps, { ...input, pageId: '../x' })).toEqual({ ok: false, error: 'page_not_offered' });
    expect(deps.selection.leadAdsEnabled).not.toHaveBeenCalled();
  });
});
