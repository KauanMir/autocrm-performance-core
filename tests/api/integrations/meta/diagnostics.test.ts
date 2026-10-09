// tests/api/integrations/meta/diagnostics.test.ts — P2.6. Rota GET
// /api/integrations/meta/diagnostics: gates, checks A–E e sanitização.
// Auth/RPCs/Graph mockados; sem rede, sem Meta, sem banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedActor: vi.fn(),
  ownerByPage: vi.fn(),
  lookupIntegration: vi.fn(),
}));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});
vi.mock('@/lib/server/meta-oauth/connection-rpc', () => ({
  createMetaConnectionRpcPort: () => ({ ownerByPage: mocks.ownerByPage, upsert: vi.fn() }),
}));
vi.mock('@/lib/server/meta-webhook/processing-rpc', () => ({
  createProcessingRpc: () => ({ lookupIntegration: mocks.lookupIntegration }),
}));

import { GET } from '@/app/api/integrations/meta/diagnostics/route';
import { runMetaLeadAdsDiagnostics } from '@/lib/server/meta-oauth/diagnostics';
import { encryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';
import {
  META_TEST_COMPANY_ID,
  META_TEST_FORM_ID,
  META_TEST_PAGE_ID,
} from '@/lib/server/meta-oauth/config';

const KEY_HEX = 'b'.repeat(64);
const APP_ID = '1234567890123456';
const PAGE_TOKEN = 'FAKE-PAGE-TOKEN-must-never-leak-123456';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const ENDPOINT = 'https://crm.example.test/api/integrations/meta/diagnostics';

let fetchMock: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

let meResponse: () => Response;
let subsResponse: () => Response;
let formsResponse: () => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function ciphertext(companyId = META_TEST_COMPANY_ID): string {
  return encryptMetaPageToken({
    plaintextToken: PAGE_TOKEN,
    companyId,
    pageId: META_TEST_PAGE_ID,
    key: Buffer.from(KEY_HEX, 'hex'),
  });
}

function connectionRow(over: Record<string, unknown> = {}) {
  return {
    integrationId: INTEGRATION_ID,
    companyId: META_TEST_COMPANY_ID,
    pageId: META_TEST_PAGE_ID,
    status: 'connected',
    ciphertext: ciphertext(),
    tokenKeyVersion: 1,
    ...over,
  };
}

function actor(opts: { isSuperAdmin?: unknown; err?: unknown } = {}) {
  return {
    ok: true as const,
    actor: { profileId: 'u' },
    jwt: 'fake.jwt',
    client: {
      rpc: vi.fn((name: string) => {
        if (name === 'is_platform_super_admin') {
          return Promise.resolve({ data: opts.isSuperAdmin ?? true, error: opts.err ?? null });
        }
        throw new Error(`unexpected rpc: ${name}`);
      }),
    },
  };
}

const request = (query = '') => new Request(`${ENDPOINT}${query}`, { method: 'GET' });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  vi.stubEnv('META_APP_ID', APP_ID);
  vi.stubEnv('META_GRAPH_API_VERSION', 'v26.0');
  vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', KEY_HEX);

  mocks.requireAuthenticatedActor.mockResolvedValue(actor());
  mocks.ownerByPage.mockResolvedValue({
    data: [{ integration_id: INTEGRATION_ID, company_id: META_TEST_COMPANY_ID, page_id: META_TEST_PAGE_ID, status: 'connected' }],
    error: null,
  });
  mocks.lookupIntegration.mockResolvedValue({ ok: true, value: connectionRow() });

  meResponse = () => json({ id: META_TEST_PAGE_ID });
  subsResponse = () =>
    json({ data: [{ id: APP_ID, name: 'KAPA CRM', subscribed_fields: ['leadgen'] }] });
  formsResponse = () =>
    json({ data: [{ id: META_TEST_FORM_ID, status: 'ACTIVE' }, { id: '999', status: 'ARCHIVED' }] });

  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const p = new URL(String(input)).pathname;
    if (p.endsWith('/me')) return meResponse();
    if (p.endsWith('/subscribed_apps')) return subsResponse();
    if (p.endsWith('/leadgen_forms')) return formsResponse();
    throw new Error(`unexpected graph call: ${p}`);
  });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
  mocks.ownerByPage.mockReset();
  mocks.lookupIntegration.mockReset();
});

function everythingSerialized(body: unknown): string {
  const logs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
  return `${JSON.stringify(body)}\n${logs}`;
}

describe('GET /api/integrations/meta/diagnostics — gates', () => {
  it('flag OFF → 403 e nenhuma chamada', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.ownerByPage).not.toHaveBeenCalled();
  });

  it('sem JWT → 401', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    expect((await GET(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manager/seller (não Super Admin) → 403', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor({ isSuperAdmin: false }));
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(mocks.ownerByPage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('company_id de piloto no query → 403 antes de qualquer lookup', async () => {
    const res = await GET(request(`?company_id=${OTHER_COMPANY_ID}`));
    expect(res.status).toBe(403);
    expect(mocks.ownerByPage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('company_id malformado → 400', async () => {
    expect((await GET(request('?company_id=abc'))).status).toBe(400);
  });

  it('Page de teste pertencente a outra company → wrong_company, sem decrypt nem Graph', async () => {
    mocks.lookupIntegration.mockResolvedValue({ ok: true, value: connectionRow({ companyId: OTHER_COMPANY_ID }) });
    const body = await (await GET(request())).json();
    expect(body.connection).toBe('failed');
    expect(body.connectionFailure).toBe('wrong_company');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/integrations/meta/diagnostics — checks', () => {
  it('tudo OK → resposta sanitizada completa, só GET, token em header', async () => {
    const res = await GET(request(`?company_id=${META_TEST_COMPANY_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      connection: 'ok',
      tokenDecrypt: 'ok',
      pageIdentity: 'ok',
      appSubscribed: true,
      leadgenSubscribed: true,
      leadgenFormsAccessible: true,
      formsCount: 2,
      formsCountTruncated: false,
      smokeFormAccessible: true,
      smokeFormActive: true,
      graphVersion: 'v26.0',
      appMode: 'verify_manually',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]));
      const init = (call[1] ?? {}) as RequestInit;
      expect(init.method).toBe('GET');
      expect(url.search).not.toContain('access_token');
      expect(url.href).not.toContain(PAGE_TOKEN);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PAGE_TOKEN}`);
    }
  });

  it('nenhum token/ciphertext/ID/nome em resposta ou logs', async () => {
    const res = await GET(request());
    const text = everythingSerialized(await res.json());
    for (const forbidden of [
      PAGE_TOKEN,
      'FAKE-PAGE',
      ciphertext().slice(0, 12),
      META_TEST_PAGE_ID,
      META_TEST_FORM_ID,
      INTEGRATION_ID,
      APP_ID,
      'KAPA CRM',
      'v1.',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('conexão ausente → missing, sem Graph', async () => {
    mocks.ownerByPage.mockResolvedValue({ data: [], error: null });
    const body = await (await GET(request())).json();
    expect(body.connection).toBe('failed');
    expect(body.connectionFailure).toBe('missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('key version não suportada → key_version_unsupported', async () => {
    mocks.lookupIntegration.mockResolvedValue({ ok: true, value: connectionRow({ tokenKeyVersion: 2 }) });
    const body = await (await GET(request())).json();
    expect(body.connectionFailure).toBe('key_version_unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha de decrypt → tokenDecrypt failed, sem Graph', async () => {
    mocks.lookupIntegration.mockResolvedValue({ ok: true, value: connectionRow({ ciphertext: ciphertext(OTHER_COMPANY_ID) }) });
    const body = await (await GET(request())).json();
    expect(body.connection).toBe('ok');
    expect(body.tokenDecrypt).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('/me devolve outra Page → pageIdentity failed, sem subscribed_apps', async () => {
    meResponse = () => json({ id: '999999' });
    const body = await (await GET(request())).json();
    expect(body.pageIdentity).toBe('failed');
    expect(body.appSubscribed).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('subscribed_apps sem o app → appSubscribed false / leadgenSubscribed false', async () => {
    subsResponse = () => json({ data: [{ id: '555', subscribed_fields: ['leadgen'] }] });
    const body = await (await GET(request())).json();
    expect(body.appSubscribed).toBe(false);
    expect(body.leadgenSubscribed).toBe(false);
  });

  it('subscribed_apps com o app mas sem leadgen → leadgenSubscribed false', async () => {
    subsResponse = () => json({ data: [{ id: APP_ID, subscribed_fields: ['feed'] }] });
    const body = await (await GET(request())).json();
    expect(body.appSubscribed).toBe(true);
    expect(body.leadgenSubscribed).toBe(false);
  });

  it('erro Graph em leadgen_forms → só code/subcode/type sanitizados, sem mensagem', async () => {
    formsResponse = () =>
      json(
        { error: { message: 'Unsupported get request SECRET-CONTEXT', type: 'GraphMethodException', code: 100, error_subcode: 33 } },
        400,
      );
    const res = await GET(request());
    const body = await res.json();
    expect(body.leadgenFormsAccessible).toBe(false);
    expect(body.formsCount).toBeNull();
    expect(body.graphErrors.leadgenForms).toEqual({
      kind: 'http',
      httpStatus: 400,
      graphCode: 100,
      graphSubcode: 33,
      graphType: 'GraphMethodException',
    });
    expect(everythingSerialized(body)).not.toContain('SECRET-CONTEXT');
  });

  it('leadgen_forms sem o form de teste → smokeFormAccessible false', async () => {
    formsResponse = () => json({ data: [{ id: '777', status: 'ACTIVE' }] });
    const body = await (await GET(request())).json();
    expect(body.leadgenFormsAccessible).toBe(true);
    expect(body.smokeFormAccessible).toBe(false);
    expect(body.smokeFormActive).toBeNull();
  });

  it('nenhuma mutação: só RPCs de leitura e nenhum método != GET', async () => {
    await GET(request());
    expect(mocks.ownerByPage).toHaveBeenCalledTimes(1);
    expect(mocks.lookupIntegration).toHaveBeenCalledTimes(1);
    const methods = fetchMock.mock.calls.map((c) => ((c[1] ?? {}) as RequestInit).method);
    expect(methods.every((m) => m === 'GET')).toBe(true);
  });
});

describe('runMetaLeadAdsDiagnostics — timeout/rede', () => {
  it('erro de rede vira kind=network sem propagar a exceção', async () => {
    const result = await runMetaLeadAdsDiagnostics({
      findConnection: async () => ({ ok: true, value: connectionRow() }),
      decrypt: () => PAGE_TOKEN,
      fetchImpl: (async () => {
        throw new Error(`boom ${PAGE_TOKEN}`);
      }) as unknown as typeof fetch,
      graphApiVersion: 'v26.0',
      appId: APP_ID,
      testCompanyId: META_TEST_COMPANY_ID,
      testPageId: META_TEST_PAGE_ID,
      testFormId: META_TEST_FORM_ID,
    });
    expect(result.pageIdentity).toBe('failed');
    expect(result.graphErrors.pageIdentity).toEqual({ kind: 'network' });
    expect(JSON.stringify(result)).not.toContain(PAGE_TOKEN);
  });
});
