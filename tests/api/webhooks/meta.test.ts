// tests/api/webhooks/meta.test.ts — Route Handler PÚBLICO do webhook
// oficial da Meta (objeto Page, campo leadgen). Sem rede real, sem App
// Secret real: segredo fake só em memória. Nenhuma chamada à Meta.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/webhooks/meta/route';

// Valores fake — nunca segredos reais.
const VERIFY_TOKEN = 'fake-verify-token-for-tests-only';
const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/meta';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

function getRequest(params: Record<string, string> | null): Request {
  const url = new URL(ENDPOINT);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new Request(url, { method: 'GET' });
}

function postRequest(opts: { body: string; headers?: Record<string, string> }): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body: opts.body,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
}

const PAGE_LEADGEN_BODY = JSON.stringify({
  object: 'page',
  entry: [
    {
      id: '1112223334445556',
      time: 1699999999,
      changes: [
        {
          field: 'leadgen',
          value: {
            page_id: '1112223334445556',
            form_id: '7778889990001112',
            leadgen_id: '9990001112223334',
            created_time: 1699999998,
            adgroup_id: '123456',
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', VERIFY_TOKEN);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/webhooks/meta (handshake de verificação)', () => {
  it('1. hub.mode=subscribe + verify token válido → 200, body exatamente igual ao challenge', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('2. verify token inválido → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
  });

  it('2b. hub.mode diferente de "subscribe" → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
  });

  it('3. parâmetros obrigatórios ausentes → 400 seguro', async () => {
    for (const params of [
      { 'hub.mode': 'subscribe' },
      { 'hub.verify_token': VERIFY_TOKEN },
      { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN },
      null,
    ]) {
      const res = await GET(getRequest(params));
      expect(res.status).toBe(400);
    }
  });

  it('4. env META_WEBHOOK_VERIFY_TOKEN ausente → falha segura (500), sem vazar segredo', async () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '');
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(VERIFY_TOKEN);
  });

  it('nunca devolve o verify token no corpo — só o challenge', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'the-challenge' }),
    );
    const text = await res.text();
    expect(text).toBe('the-challenge');
    expect(text).not.toContain(VERIFY_TOKEN);
  });

  it('nunca loga o verify token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await GET(getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'x' }));
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(VERIFY_TOKEN);
  });
});

describe('POST /api/webhooks/meta (eventos)', () => {
  it('5. assinatura válida (Page + leadgen) → 200', async () => {
    const res = await POST(
      postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY) } }),
    );
    expect(res.status).toBe(200);
  });

  it('6. assinatura incorreta → 403', async () => {
    const res = await POST(
      postRequest({
        body: PAGE_LEADGEN_BODY,
        headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY, 'a-different-secret') },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('7. ausência de X-Hub-Signature-256 → 403', async () => {
    const res = await POST(postRequest({ body: PAGE_LEADGEN_BODY }));
    expect(res.status).toBe(403);
  });

  it('8. formato inválido da assinatura → 403', async () => {
    for (const bad of [
      'nonsense',
      'sha1=abc',
      'sha256=',
      'sha256=zzzz',
      `sha256=${'a'.repeat(63)}`,
      `sha256=${'a'.repeat(65)}`,
      `${createHmac('sha256', APP_SECRET).update(PAGE_LEADGEN_BODY).digest('hex')}`, // sem prefixo
    ]) {
      const res = await POST(
        postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': bad } }),
      );
      expect(res.status).toBe(403);
    }
  });

  it('a assinatura é calculada sobre o RAW BODY exato (byte a byte)', async () => {
    // Corpo com espaçamento não canônico.
    const raw = '{"object":"page",  "entry":[]}';
    const ok = await POST(postRequest({ body: raw, headers: { 'X-Hub-Signature-256': sign(raw) } }));
    expect(ok.status).toBe(200);

    // Assinar a versão reserializada (bytes diferentes) tem que falhar.
    const reserialized = JSON.stringify(JSON.parse(raw));
    const bad = await POST(
      postRequest({ body: raw, headers: { 'X-Hub-Signature-256': sign(reserialized) } }),
    );
    expect(bad.status).toBe(403);
  });

  it('9. evento Page + leadgen válido → processado sem erro, 200, loga só metadados técnicos', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY) } }),
    );
    expect(res.status).toBe(200);
    const logged = logSpy.mock.calls.map((a) => JSON.stringify(a)).join('\n');
    expect(logged).toContain('leadgen_received');
    expect(logged).toContain('7778889990001112'); // form_id — metadado técnico permitido
    expect(logged).toContain('9990001112223334'); // leadgen_id — metadado técnico permitido
  });

  it('10. evento Page não relacionado a leadgen → ignorado, 200', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: '1', time: 1, changes: [{ field: 'feed', value: { item: 'status' } }] }],
    });
    const res = await POST(postRequest({ body, headers: { 'X-Hub-Signature-256': sign(body) } }));
    expect(res.status).toBe(200);
  });

  it('10b. objeto não-Page (instagram) → ignorado, 200', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [] });
    const res = await POST(postRequest({ body, headers: { 'X-Hub-Signature-256': sign(body) } }));
    expect(res.status).toBe(200);
  });

  it('11. JSON inválido com assinatura válida → resposta segura (400), sem crash', async () => {
    const raw = '{not valid json';
    const res = await POST(postRequest({ body: raw, headers: { 'X-Hub-Signature-256': sign(raw) } }));
    expect(res.status).toBe(400);
  });

  it('12. payloads desconhecidos com assinatura válida → tolerados (200), nunca lançam', async () => {
    for (const raw of [
      'null',
      '"just a string"',
      '123',
      '{}',
      '{"object":"page"}',
      '{"object":"page","entry":"not-an-array"}',
      '{"object":"page","entry":[{"changes":[{}]}]}',
      '{"object":"page","entry":[{"changes":[{"field":"leadgen"}]}]}',
      '{"weird":true}',
    ]) {
      const res = await POST(postRequest({ body: raw, headers: { 'X-Hub-Signature-256': sign(raw) } }));
      expect(res.status).toBe(200);
    }
  });

  it('env META_APP_SECRET ausente → falha segura (500, fail closed), sem processar evento', async () => {
    vi.stubEnv('META_APP_SECRET', '');
    const res = await POST(
      postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY) } }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(APP_SECRET);
  });

  it('nunca loga segredos nem a assinatura (recebida ou calculada)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const header = sign(PAGE_LEADGEN_BODY);
    await POST(postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': header } }));
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toContain(header);
    expect(logged).not.toContain(header.slice('sha256='.length));
  });

  it('nunca loga PII do lead mesmo se vier no payload', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'leadgen',
              value: {
                page_id: '1',
                form_id: '2',
                leadgen_id: '3',
                created_time: 100,
                // campos que NÃO devem aparecer em log:
                field_data: [
                  { name: 'full_name', values: ['Fulano de Tal'] },
                  { name: 'phone_number', values: ['+55 11 99999-0000'] },
                  { name: 'email', values: ['fulano@example.com'] },
                ],
              },
            },
          ],
        },
      ],
    });
    await POST(postRequest({ body, headers: { 'X-Hub-Signature-256': sign(body) } }));
    const logged = logSpy.mock.calls.map((a) => JSON.stringify(a)).join('\n');
    expect(logged).not.toContain('Fulano de Tal');
    expect(logged).not.toContain('99999-0000');
    expect(logged).not.toContain('fulano@example.com');
    expect(logged).not.toContain('field_data');
  });

  it('não faz chamada de rede (fetch / Graph API) ao processar evento leadgen', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((() => {
        throw new Error('rede não permitida nesta fase');
      }) as typeof fetch);
    const res = await POST(
      postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY) } }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resposta tem Cache-Control: no-store', async () => {
    const res = await POST(
      postRequest({ body: PAGE_LEADGEN_BODY, headers: { 'X-Hub-Signature-256': sign(PAGE_LEADGEN_BODY) } }),
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
