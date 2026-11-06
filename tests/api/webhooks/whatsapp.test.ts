// tests/api/webhooks/whatsapp.test.ts — Route Handler PÚBLICO do webhook
// oficial da WhatsApp Cloud API (Fase W1). Sem rede real, sem segredo real:
// valores fake só em memória. fetch global, Supabase admin, waitUntil e a
// ingestão do Lead Ads ficam espionados para provar zero side effect.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  waitUntil: vi.fn(),
  ingestLeadgenChange: vi.fn(),
  scheduleMetaLeadgenProcessing: vi.fn(),
}));

vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/server/meta-webhook/ingestion', () => ({ ingestLeadgenChange: mocks.ingestLeadgenChange }));
vi.mock('@/lib/server/meta-webhook/schedule-leadgen-processing', () => ({
  scheduleMetaLeadgenProcessing: mocks.scheduleMetaLeadgenProcessing,
}));

import { GET, POST } from '@/app/api/webhooks/whatsapp/route';

// Valores fake — nunca segredos reais.
const VERIFY_TOKEN = 'fake-whatsapp-verify-token-for-tests-only';
const META_VERIFY_TOKEN = 'fake-meta-leadads-verify-token-for-tests-only';
const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/whatsapp';

// PII/IDs fake que NUNCA podem aparecer em log nem em resposta.
const PHONE_NUMBER_ID = '106540352242922';
const DISPLAY_PHONE = '15550783881';
const WABA_ID = '102290129340398';
const CUSTOMER_PHONE = '5511987654321';
const CONTACT_NAME = 'Fulana de Tal Teste';
const MESSAGE_ID = 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=';
const STATUS_MESSAGE_ID = 'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI4QUZBMjZDQjM2NUUwNkQ3MQA=';
const MESSAGE_TEXT = 'Olá, quero saber o preço do apartamento 302';
const SENSITIVE = [
  PHONE_NUMBER_ID,
  DISPLAY_PHONE,
  WABA_ID,
  CUSTOMER_PHONE,
  CONTACT_NAME,
  MESSAGE_ID,
  STATUS_MESSAGE_ID,
  MESSAGE_TEXT,
  VERIFY_TOKEN,
  APP_SECRET,
];

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

function postRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function signedPost(body: string): Request {
  return postRequest(body, { 'X-Hub-Signature-256': sign(body) });
}

function metadata() {
  return { display_phone_number: DISPLAY_PHONE, phone_number_id: PHONE_NUMBER_ID };
}

function messageValue() {
  return {
    messaging_product: 'whatsapp',
    metadata: metadata(),
    contacts: [{ profile: { name: CONTACT_NAME }, wa_id: CUSTOMER_PHONE }],
    messages: [
      {
        from: CUSTOMER_PHONE,
        id: MESSAGE_ID,
        timestamp: '1730000000',
        text: { body: MESSAGE_TEXT },
        type: 'text',
      },
    ],
  };
}

function statusValue(status = 'delivered') {
  return {
    messaging_product: 'whatsapp',
    metadata: metadata(),
    statuses: [
      {
        id: STATUS_MESSAGE_ID,
        status,
        timestamp: '1730000001',
        recipient_id: CUSTOMER_PHONE,
      },
    ],
  };
}

function wabaBody(entries: Array<Array<{ field: string; value: unknown }>>): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: entries.map((changes) => ({ id: WABA_ID, changes })),
  });
}

const MESSAGE_BODY = wabaBody([[{ field: 'messages', value: messageValue() }]]);
const STATUS_BODY = wabaBody([[{ field: 'messages', value: statusValue() }]]);

let fetchSpy: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function loggedText(): string {
  return [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => a.join(' ')).join('\n');
}

function loggedJson(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .filter((a) => a[0] === '[whatsapp-webhook]')
    .map((a) => JSON.parse(String(a[1])) as Record<string, unknown>);
}

beforeEach(() => {
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', VERIFY_TOKEN);
  vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', META_VERIFY_TOKEN);
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  // Mesmo com a ingestão Lead Ads ligada, o webhook WhatsApp não a toca.
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  fetchSpy = vi.fn(() => {
    throw new Error('network is forbidden in this test');
  });
  vi.stubGlobal('fetch', fetchSpy);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Nenhuma chamada Graph/Supabase, nenhum waitUntil, nenhuma ingestão.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.waitUntil).not.toHaveBeenCalled();
  expect(mocks.ingestLeadgenChange).not.toHaveBeenCalled();
  expect(mocks.scheduleMetaLeadgenProcessing).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('GET /api/webhooks/whatsapp (handshake de verificação)', () => {
  it('challenge válido → 200 com o challenge exato em text/plain no-store', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('verify token inválido → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('abc');
  });

  it('verify token do Lead Ads (META_WEBHOOK_VERIFY_TOKEN) não serve para o WhatsApp → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': META_VERIFY_TOKEN, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
  });

  it('token com prefixo correto mas tamanho diferente → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': `${VERIFY_TOKEN}x`, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
  });

  it('hub.mode diferente de "subscribe" → 403', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(403);
  });

  it('parâmetros obrigatórios ausentes → 400', async () => {
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

  it('WHATSAPP_WEBHOOK_VERIFY_TOKEN ausente → 500 fechado (não cai no token do Lead Ads)', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': META_VERIFY_TOKEN, 'hub.challenge': 'abc' }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('server misconfigured');
  });

  it('nunca loga nem devolve o verify token', async () => {
    const ok = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'the-challenge' }),
    );
    expect(await ok.text()).toBe('the-challenge');
    await GET(getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess-123', 'hub.challenge': 'x' }));
    const logged = loggedText();
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toContain('guess-123');
    expect(loggedJson().map((l) => l.result)).toEqual(['ok', 'rejected']);
  });
});

describe('POST /api/webhooks/whatsapp — assinatura', () => {
  it('assinatura válida → 200', async () => {
    const res = await POST(signedPost(MESSAGE_BODY));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('assinatura com outro segredo → 403', async () => {
    const res = await POST(postRequest(MESSAGE_BODY, { 'X-Hub-Signature-256': sign(MESSAGE_BODY, 'other-secret') }));
    expect(res.status).toBe(403);
    expect(loggedJson()[0].result).toBe('signature_mismatch');
  });

  it('header ausente → 403', async () => {
    const res = await POST(postRequest(MESSAGE_BODY));
    expect(res.status).toBe(403);
    expect(loggedJson()[0].result).toBe('signature_missing');
  });

  it('formatos inválidos de assinatura → 403', async () => {
    for (const bad of [
      'nonsense',
      'sha1=abc',
      'sha256=',
      'sha256=zzzz',
      `sha256=${'a'.repeat(63)}`,
      `sha256=${'a'.repeat(65)}`,
      createHmac('sha256', APP_SECRET).update(MESSAGE_BODY).digest('hex'),
    ]) {
      const res = await POST(postRequest(MESSAGE_BODY, { 'X-Hub-Signature-256': bad }));
      expect(res.status).toBe(403);
    }
  });

  it('HMAC é sobre o RAW BODY exato — assinar a versão reserializada falha', async () => {
    const raw = '{"object":"whatsapp_business_account",   "entry":[]}';
    expect((await POST(signedPost(raw))).status).toBe(200);
    const reserialized = JSON.stringify(JSON.parse(raw));
    const bad = await POST(postRequest(raw, { 'X-Hub-Signature-256': sign(reserialized) }));
    expect(bad.status).toBe(403);
  });

  it('META_APP_SECRET ausente → 500 fechado, sem validar nada', async () => {
    vi.stubEnv('META_APP_SECRET', '');
    const res = await POST(signedPost(MESSAGE_BODY));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('server misconfigured');
  });

  it('assinatura inválida + JSON inválido → 403 (assinatura antes do parse)', async () => {
    const res = await POST(postRequest('{not json', { 'X-Hub-Signature-256': sign('{}') }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/webhooks/whatsapp — payload', () => {
  it('JSON inválido com assinatura válida → 400', async () => {
    const res = await POST(signedPost('{not json'));
    expect(res.status).toBe(400);
    expect(loggedJson()[0].result).toBe('invalid_json');
  });

  it('payload vazio (corpo vazio) → 200 ignorado', async () => {
    const res = await POST(signedPost(''));
    expect(res.status).toBe(200);
    expect(loggedJson()[0]).toMatchObject({ result: 'ignored_non_whatsapp', eventType: 'ignored' });
  });

  it('payload {} → 200 ignorado', async () => {
    const res = await POST(signedPost('{}'));
    expect(res.status).toBe(200);
    expect(loggedJson()[0].result).toBe('ignored_non_whatsapp');
  });

  it('object diferente (ex.: page do Lead Ads) → 200 ignorado, sem logar o object', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: '1', changes: [{ field: 'leadgen', value: { leadgen_id: '999' } }] }],
    });
    const res = await POST(signedPost(body));
    expect(res.status).toBe(200);
    const [line] = loggedJson();
    expect(line.result).toBe('ignored_non_whatsapp');
    expect(line).not.toHaveProperty('object');
  });

  it('WABA com entry vazio → 200 ignored_no_events', async () => {
    const res = await POST(signedPost(JSON.stringify({ object: 'whatsapp_business_account', entry: [] })));
    expect(res.status).toBe(200);
    expect(loggedJson().at(-1)).toMatchObject({
      result: 'ignored_no_events',
      messageReceivedCount: 0,
      messageStatusCount: 0,
      ignoredChangeCount: 0,
    });
  });

  it('mensagem recebida → message_received com metadados booleanos', async () => {
    const res = await POST(signedPost(MESSAGE_BODY));
    expect(res.status).toBe(200);
    const lines = loggedJson();
    expect(lines[0]).toEqual({
      operation: 'whatsapp_webhook',
      requestId: expect.any(String),
      phase: 'event',
      result: 'classified',
      eventType: 'message_received',
      hasPhoneNumberId: true,
      hasMessageId: true,
      messageType: 'text',
    });
    expect(lines.at(-1)).toMatchObject({ result: 'accepted', messageReceivedCount: 1, messageStatusCount: 0 });
  });

  it('status recebido → message_status com status da allowlist', async () => {
    const res = await POST(signedPost(STATUS_BODY));
    expect(res.status).toBe(200);
    const lines = loggedJson();
    expect(lines[0]).toEqual({
      operation: 'whatsapp_webhook',
      requestId: expect.any(String),
      phase: 'event',
      result: 'classified',
      eventType: 'message_status',
      hasPhoneNumberId: true,
      hasMessageId: true,
      status: 'delivered',
      hasErrors: false,
    });
    expect(lines.at(-1)).toMatchObject({ result: 'accepted', messageReceivedCount: 0, messageStatusCount: 1 });
  });

  it('múltiplos entries/changes/itens → todos classificados; fields desconhecidos ignorados', async () => {
    const value = messageValue();
    value.messages.push({ ...value.messages[0], id: 'wamid.second', type: 'image' });
    const body = wabaBody([
      [
        { field: 'messages', value },
        { field: 'message_template_status_update', value: { event: 'APPROVED' } },
      ],
      [
        { field: 'messages', value: statusValue('read') },
        { field: 'messages', value: { ...statusValue('failed'), messages: messageValue().messages } },
      ],
      [{ field: 'messages', value: { metadata: metadata(), errors: [{ code: 131000 }] } }],
    ]);
    const res = await POST(signedPost(body));
    expect(res.status).toBe(200);
    const lines = loggedJson();
    const classified = lines.filter((l) => l.result === 'classified');
    expect(classified.map((l) => l.eventType)).toEqual([
      'message_received',
      'message_received',
      'message_status',
      'message_received',
      'message_status',
    ]);
    expect(classified.map((l) => l.messageType ?? l.status)).toEqual(['text', 'image', 'read', 'text', 'failed']);
    expect(lines.at(-1)).toMatchObject({
      result: 'accepted',
      messageReceivedCount: 3,
      messageStatusCount: 2,
      ignoredChangeCount: 2,
    });
  });

  it('tipo/status fora da allowlist vira "other" (string arbitrária nunca vai para log)', async () => {
    const value = messageValue();
    value.messages[0].type = `x-${CONTACT_NAME}`;
    const status = statusValue(`s-${CUSTOMER_PHONE}`);
    const body = wabaBody([[{ field: 'messages', value }, { field: 'messages', value: status }]]);
    await POST(signedPost(body));
    const classified = loggedJson().filter((l) => l.result === 'classified');
    expect(classified[0].messageType).toBe('other');
    expect(classified[1].status).toBe('other');
  });

  it('formas inesperadas (entry/changes/value não-objeto, ids ausentes) não quebram', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        null,
        'x',
        { changes: 'nope' },
        { changes: [null, { field: 'messages' }, { field: 'messages', value: [] }] },
        { changes: [{ field: 'messages', value: { messages: [null, { type: 'text' }], statuses: [7] } }] },
      ],
    });
    const res = await POST(signedPost(body));
    expect(res.status).toBe(200);
    const classified = loggedJson().filter((l) => l.result === 'classified');
    expect(classified).toEqual([
      expect.objectContaining({ eventType: 'message_received', hasPhoneNumberId: false, hasMessageId: false }),
    ]);
  });

  it('limita linhas de log por evento, mas o resumo traz a contagem total', async () => {
    const value = messageValue();
    value.messages = Array.from({ length: 60 }, (_, i) => ({ ...value.messages[0], id: `wamid.${i}` }));
    await POST(signedPost(wabaBody([[{ field: 'messages', value }]])));
    const lines = loggedJson();
    expect(lines.filter((l) => l.result === 'classified')).toHaveLength(50);
    expect(lines.at(-1)).toMatchObject({ result: 'accepted', messageReceivedCount: 60 });
  });
});

describe('POST /api/webhooks/whatsapp — privacidade e isolamento', () => {
  it('nenhum PII/ID/token/segredo/payload bruto em log ou resposta', async () => {
    const bodies = [MESSAGE_BODY, STATUS_BODY, '{not json', ''];
    const responses: string[] = [];
    for (const body of bodies) {
      responses.push(await (await POST(signedPost(body))).text());
    }
    responses.push(await (await POST(postRequest(MESSAGE_BODY, { 'X-Hub-Signature-256': sign('x') }))).text());
    const logged = loggedText();
    for (const value of SENSITIVE) {
      expect(logged).not.toContain(value);
      for (const r of responses) expect(r).not.toContain(value);
    }
    expect(logged).not.toContain(sign(MESSAGE_BODY).slice(7, 23));
    expect(logged).not.toContain('"entry"');
  });

  it('a rota só importa a allowlist prevista (Supabase só via ingestão WhatsApp, atrás da flag)', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/api/webhooks/whatsapp/route.ts'), 'utf8');
    const imports = (source.match(/from\s+'[^']+'/g) ?? []).map((s) => s.replace(/^from\s+'|'$/g, ''));
    expect(imports.sort()).toEqual(
      [
        '@/lib/server/meta-webhook/signature',
        '@/lib/server/whatsapp-webhook/env',
        '@/lib/server/whatsapp-webhook/events',
        '@/lib/server/whatsapp-webhook/ingestion',
        '@/lib/server/whatsapp-webhook/logger',
        'node:crypto',
      ].sort(),
    );
  });

  it('módulos WhatsApp não importam Graph, waitUntil, OAuth nem a ingestão/processamento Lead Ads', () => {
    const root = process.cwd();
    const files = [
      'app/api/webhooks/whatsapp/route.ts',
      'lib/server/whatsapp-webhook/env.ts',
      'lib/server/whatsapp-webhook/events.ts',
      'lib/server/whatsapp-webhook/logger.ts',
      'lib/server/whatsapp-webhook/ingestion.ts',
      'lib/server/whatsapp-webhook/events-rpc.ts',
      'lib/server/whatsapp-webhook/event-hashes.ts',
      'lib/server/whatsapp-webhook/inbound-parser.ts',
      'lib/server/whatsapp-webhook/capture-rpc.ts',
      'lib/server/whatsapp-connection/capture-crypto.ts',
      'lib/server/whatsapp-connection/connection-rpc.ts',
      'lib/server/whatsapp-connection/connection-persistence.ts',
      'lib/server/whatsapp-connection/token-crypto.ts',
      'lib/server/whatsapp-connection/env.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      const imports = source.match(/from\s+'[^']+'/g) ?? [];
      for (const spec of imports) {
        expect(spec).not.toMatch(/graph|@vercel\/functions|meta-oauth|meta-webhook\/(?!signature')|process-|schedule/);
      }
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
    // W1 (env/events/logger) continua sem nenhum acesso a banco.
    for (const file of files.slice(1, 4)) {
      expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(/supabase/i);
    }
  });

  it('webhook do Lead Ads (/api/webhooks/meta) continua independente do WhatsApp', () => {
    const root = process.cwd();
    const metaRoute = readFileSync(resolve(root, 'app/api/webhooks/meta/route.ts'), 'utf8');
    expect(metaRoute).not.toMatch(/whatsapp/i);
  });
});
