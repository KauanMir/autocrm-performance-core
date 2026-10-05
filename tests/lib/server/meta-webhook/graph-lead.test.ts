// @vitest-environment node
// Cliente Graph puro com fetch injetado. Nenhuma rede real. Token fake.
import { describe, expect, it } from 'vitest';
import {
  buildGraphLeadUrl,
  fetchMetaLead,
  GRAPH_LEAD_FIELDS,
  GRAPH_TIMEOUT_MS,
  mapGraphErrorResponse,
  type LeadFetcher,
} from '@/lib/server/meta-webhook/graph-lead';

const TOKEN = 'FAKE-PAGE-TOKEN-p2-1-not-real';
const LEADGEN = '9990001112223334';
const VERSION = 'v26.0';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeFetch(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: LeadFetcher = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetcher, calls };
}

const run = (fetcher: LeadFetcher, extra: Record<string, unknown> = {}) =>
  fetchMetaLead({ graphApiVersion: VERSION, leadgenId: LEADGEN, pageAccessToken: TOKEN, fetcher, ...extra });

describe('contrato da requisição', () => {
  it('URL usa versão e leadgen_id, GET, fields somente os 5 aprovados', async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    await run(fetcher);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/${VERSION}/${LEADGEN}`);
    expect(calls[0].init.method).toBe('GET');
    expect(url.searchParams.get('fields')).toBe('id,created_time,ad_id,form_id,field_data');
    expect(GRAPH_LEAD_FIELDS).toEqual(['id', 'created_time', 'ad_id', 'form_id', 'field_data']);
  });

  it('token vai no header Authorization e nunca na URL', async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    await run(fetcher);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain('access_token');
  });

  it('signal de AbortController é passado ao fetch', async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    await run(fetcher);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout padrão é 8 s', () => {
    expect(GRAPH_TIMEOUT_MS).toBe(8000);
  });

  it('versão ou leadgen_id com formato inválido não chama o fetch', async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    expect(buildGraphLeadUrl('26.0', LEADGEN)).toBeNull();
    expect(buildGraphLeadUrl(VERSION, 'abc')).toBeNull();
    expect(buildGraphLeadUrl(VERSION, '')).toBeNull();
    const r = await fetchMetaLead({ graphApiVersion: '26.0', leadgenId: LEADGEN, pageAccessToken: TOKEN, fetcher });
    expect(r).toEqual({ ok: false, code: 'graph_malformed' });
    expect(calls).toHaveLength(0);
  });

  it('token vazio → token_invalid sem chamar o fetch', async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    const r = await fetchMetaLead({ graphApiVersion: VERSION, leadgenId: LEADGEN, pageAccessToken: '', fetcher });
    expect(r).toEqual({ ok: false, code: 'token_invalid' });
    expect(calls).toHaveLength(0);
  });
});

describe('sucesso e payload', () => {
  it('200 válido devolve id e field_data', async () => {
    const fieldData = [{ name: 'full_name', values: ['Cliente Teste'] }];
    const { fetcher } = fakeFetch(() =>
      json(200, { id: LEADGEN, created_time: '2026-10-05T12:00:00+0000', ad_id: '1', form_id: '2', field_data: fieldData }),
    );
    const r = await run(fetcher);
    expect(r).toEqual({ ok: true, value: { id: LEADGEN, fieldData } });
  });

  it('200 sem field_data → graph_malformed', async () => {
    const { fetcher } = fakeFetch(() => json(200, { id: LEADGEN }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_malformed' });
  });

  it('200 com field_data não-array → graph_malformed', async () => {
    const { fetcher } = fakeFetch(() => json(200, { id: LEADGEN, field_data: 'x' }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_malformed' });
  });

  it('200 com id diferente do leadgen pedido → graph_malformed', async () => {
    const { fetcher } = fakeFetch(() => json(200, { id: '1', field_data: [] }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_malformed' });
  });

  it('200 com JSON inválido → graph_malformed', async () => {
    const { fetcher } = fakeFetch(() => new Response('<html>', { status: 200 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_malformed' });
  });

  it('200 com corpo não-objeto → graph_malformed', async () => {
    const { fetcher } = fakeFetch(() => json(200, ['x']));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_malformed' });
  });
});

describe('erros (PROVISÓRIO quando não confirmados pela doc)', () => {
  it('190 → token_invalid (confirmado)', async () => {
    const { fetcher } = fakeFetch(() => json(400, { error: { code: 190, message: 'expired' } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'token_invalid' });
  });

  it('401 com code 190 → token_invalid', async () => {
    const { fetcher } = fakeFetch(() => json(401, { error: { code: 190, error_subcode: 463 } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'token_invalid' });
  });

  it('code 10 → graph_permission_missing', async () => {
    const { fetcher } = fakeFetch(() => json(403, { error: { code: 10 } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_permission_missing' });
  });

  it('code 200–299 → graph_permission_missing', async () => {
    const { fetcher } = fakeFetch(() => json(400, { error: { code: 200 } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_permission_missing' });
  });

  it('403 sem code reconhecido → graph_permission_missing (PROVISÓRIO)', async () => {
    const { fetcher } = fakeFetch(() => new Response('', { status: 403 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_permission_missing' });
  });

  it('code 4 / 17 (rate limit) → graph_error retryable', async () => {
    const { fetcher: f4 } = fakeFetch(() => json(400, { error: { code: 4 } }));
    expect(await run(f4)).toEqual({ ok: false, code: 'graph_error' });
    const { fetcher: f17 } = fakeFetch(() => json(400, { error: { code: 17 } }));
    expect(await run(f17)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('429 → graph_error retryable', async () => {
    const { fetcher } = fakeFetch(() => new Response('', { status: 429 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('500 → graph_error', async () => {
    const { fetcher } = fakeFetch(() => new Response('', { status: 500 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('erro sem JSON legível → graph_error', async () => {
    const { fetcher } = fakeFetch(() => new Response('not json', { status: 400 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('objeto inexistente (400, code 100) → lead_not_found (PROVISÓRIO, validar no smoke)', async () => {
    const { fetcher } = fakeFetch(() => json(400, { error: { code: 100, error_subcode: 33 } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'lead_not_found' });
  });

  it('404 com code 100 → lead_not_found (PROVISÓRIO)', async () => {
    const { fetcher } = fakeFetch(() => json(404, { error: { code: 100 } }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'lead_not_found' });
  });

  it('404 sem code reconhecido → graph_error (não inventa lead_not_found)', async () => {
    const { fetcher } = fakeFetch(() => new Response('', { status: 404 }));
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('mapeamento puro cobre as categorias', () => {
    expect(mapGraphErrorResponse(400, 190)).toBe('token_invalid');
    expect(mapGraphErrorResponse(403, 10)).toBe('graph_permission_missing');
    expect(mapGraphErrorResponse(400, 294)).toBe('graph_permission_missing');
    expect(mapGraphErrorResponse(403, 4)).toBe('graph_error');
    expect(mapGraphErrorResponse(503, undefined)).toBe('graph_error');
    expect(mapGraphErrorResponse(400, 100)).toBe('lead_not_found');
    expect(mapGraphErrorResponse(404, 100)).toBe('lead_not_found');
    expect(mapGraphErrorResponse(500, 100)).toBe('graph_error');
  });
});

describe('falhas de transporte', () => {
  it('network error → graph_error', async () => {
    const fetcher: LeadFetcher = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await run(fetcher)).toEqual({ ok: false, code: 'graph_error' });
  });

  it('timeout (abort) → graph_timeout', async () => {
    const fetcher: LeadFetcher = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const r = await run(fetcher, { timeoutMs: 20 });
    expect(r).toEqual({ ok: false, code: 'graph_timeout' });
  });
});

describe('segurança do token e dos erros', () => {
  it('erro com token/URL na mensagem não vaza no resultado', async () => {
    const fetcher: LeadFetcher = async (url) => {
      throw new Error(`boom ${url} ${TOKEN}`);
    };
    const r = await run(fetcher);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain('graph.facebook.com');
    expect(r).toEqual({ ok: false, code: 'graph_error' });
  });

  it('corpo de erro Meta com mensagem sensível não vaza no resultado', async () => {
    const { fetcher } = fakeFetch(() =>
      json(400, { error: { code: 100, message: `Invalid param ${TOKEN} ${LEADGEN}` } }),
    );
    const r = await run(fetcher);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(LEADGEN);
  });

  it('sucesso não devolve token', async () => {
    const { fetcher } = fakeFetch(() => json(200, { id: LEADGEN, field_data: [] }));
    expect(JSON.stringify(await run(fetcher))).not.toContain(TOKEN);
  });
});
