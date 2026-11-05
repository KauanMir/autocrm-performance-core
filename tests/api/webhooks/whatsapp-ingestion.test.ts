// tests/api/webhooks/whatsapp-ingestion.test.ts — W2B-5: rota real, parser real e
// criptografia real, com chaves fictícias. As RPCs são substituídas por um banco
// em memória que reproduz a idempotência; as RPCs reais têm pgTAP próprio.
// Nenhuma rede, nenhum Graph, nenhum banco real, nenhum segredo real.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  capture: vi.fn(),
  markFailed: vi.fn(),
  register: vi.fn(),
  createAdminClient: vi.fn(),
  waitUntil: vi.fn(),
  ingestLeadgenChange: vi.fn(),
}));

vi.mock('@/lib/server/whatsapp-webhook/capture-rpc', () => ({
  loadWhatsAppCaptureContext: mocks.loadContext,
  captureInboundMessage: mocks.capture,
  markInboundEventFailed: mocks.markFailed,
}));
vi.mock('@/lib/server/whatsapp-webhook/events-rpc', () => ({ registerWhatsAppEvent: mocks.register }));
vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/server/meta-webhook/ingestion', () => ({ ingestLeadgenChange: mocks.ingestLeadgenChange }));

import { POST } from '@/app/api/webhooks/whatsapp/route';
import {
  decryptWhatsAppContactPii,
  decryptWhatsAppMessageContent,
} from '@/lib/server/whatsapp-connection/capture-crypto';

const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/whatsapp';
const CONTENT_KEY_HEX = 'c'.repeat(64);
const HMAC_KEY_HEX = 'd'.repeat(64);

const PHONE_A = '106540352242922';
const PHONE_B = '106540352242933';
const PHONE_UNKNOWN = '106540352249999';
const WABA_A = '102290129340398';
const WABA_B = '102290129340399';
const COMPANY_A = 'fa3eeeee-1111-4111-8111-111111111111';
const COMPANY_B = 'fa3eeeee-2222-4222-8222-222222222222';
const CONN_A = 'fa3a0000-0000-4000-8000-00000000000a';
const CONN_B = 'fa3a0000-0000-4000-8000-00000000000b';
const CUSTOMER_PHONE = '5511987654321';
const CONTACT_NAME = 'Fulana de Tal Teste';
const MESSAGE_TEXT = 'Quero saber o preço do apartamento 302';
const WAMID_1 = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==';
const WAMID_2 = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAyAA==';
const WAMID_OUT = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABEYEjAwMDAwMDAwMDAwMDAwMDAwMwA=';
const SENSITIVE = [PHONE_A, PHONE_B, PHONE_UNKNOWN, WABA_A, CUSTOMER_PHONE, CONTACT_NAME, MESSAGE_TEXT, WAMID_1,
  WAMID_2, WAMID_OUT, APP_SECRET, CONTENT_KEY_HEX, HMAC_KEY_HEX, COMPANY_A, CONN_A];

const hashOf = (wamid: string) => createHash('sha256').update(`whatsapp-message-id:v1:${wamid}`, 'utf8').digest('hex');

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;
}

function post(body: string): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) },
  });
}

function message(id: string, over: Record<string, unknown> = {}) {
  return { from: CUSTOMER_PHONE, id, timestamp: '1730000000', text: { body: MESSAGE_TEXT }, type: 'text', ...over };
}

function status(id: string, value: string) {
  return { id, status: value, timestamp: '1730000001', recipient_id: CUSTOMER_PHONE };
}

function value(phoneNumberId: string, extra: Record<string, unknown>) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550783881', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: CONTACT_NAME }, wa_id: CUSTOMER_PHONE }],
    ...extra,
  };
}

function entry(wabaId: string | undefined, ...values: Array<Record<string, unknown>>) {
  return { id: wabaId, changes: values.map((v) => ({ field: 'messages', value: v })) };
}

function body(...values: Array<Record<string, unknown>>): string {
  return JSON.stringify({ object: 'whatsapp_business_account', entry: [entry(WABA_A, ...values)] });
}

// Banco em memória: reproduz a unicidade por (empresa, hash) e por event_key.
let messages: Map<string, Record<string, unknown>>;
let statuses: Map<string, Record<string, unknown>>;
let captureAllowed: Record<string, boolean>;
let fetchSpy: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function loggedJson(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .filter((a) => a[0] === '[whatsapp-webhook]')
    .map((a) => JSON.parse(String(a[1])) as Record<string, unknown>);
}

function loggedText(): string {
  return [...logSpy.mock.calls, ...errSpy.mock.calls].map((a) => a.join(' ')).join('\n');
}

const ingestionLog = () => loggedJson().find((l) => l.result === 'ingestion' || l.result === 'ingestion_infra_failure');

beforeEach(() => {
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'fake-verify');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_INGESTION_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', CONTENT_KEY_HEX);
  vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', HMAC_KEY_HEX);

  messages = new Map();
  statuses = new Map();
  captureAllowed = { [PHONE_A]: true, [PHONE_B]: true };

  mocks.loadContext.mockImplementation(async (phoneNumberId: string) => {
    if (phoneNumberId === PHONE_A) {
      return { ok: true, value: { connectionId: CONN_A, companyId: COMPANY_A, wabaId: WABA_A, captureAllowed: captureAllowed[PHONE_A] } };
    }
    if (phoneNumberId === PHONE_B) {
      return { ok: true, value: { connectionId: CONN_B, companyId: COMPANY_B, wabaId: WABA_B, captureAllowed: captureAllowed[PHONE_B] } };
    }
    return { ok: true, value: null };
  });
  mocks.capture.mockImplementation(async (input: Record<string, unknown>) => {
    const key = `${input.companyId}:${input.messageIdHash}`;
    if (messages.has(key)) return { ok: true, outcome: 'duplicate' };
    messages.set(key, input);
    return { ok: true, outcome: 'captured' };
  });
  mocks.markFailed.mockResolvedValue({ ok: true });
  mocks.register.mockImplementation(async (input: Record<string, unknown>) => {
    const key = [input.phoneNumberId, input.messageIdHash, input.statusKeyHash].join(':');
    const created = !statuses.has(key);
    statuses.set(key, input);
    return { ok: true, value: { eventId: 'evt', created } };
  });

  fetchSpy = vi.fn(() => {
    throw new Error('network is forbidden in this test');
  });
  vi.stubGlobal('fetch', fetchSpy);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.waitUntil).not.toHaveBeenCalled();
  expect(mocks.ingestLeadgenChange).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('flag WHATSAPP_INGESTION_ENABLED', () => {
  it.each([
    ['ausente', undefined],
    ['"false"', 'false'],
    ['"TRUE" (só "true" exato liga)', 'TRUE'],
    ['"1"', '1'],
  ])('flag %s → comportamento da W1: zero ingestão, logs idênticos', async (_label, flag) => {
    vi.stubEnv('WHATSAPP_INGESTION_ENABLED', flag as unknown as string);
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(loggedJson().map((l) => l.result)).toEqual(['classified', 'accepted']);
  });
});

describe('recebimento válido', () => {
  it('captura na empresa certa, só com hash e ciphertext', async () => {
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const input = mocks.capture.mock.calls[0][0];
    expect(input).toMatchObject({
      connectionId: CONN_A,
      companyId: COMPANY_A,
      phoneNumberId: PHONE_A,
      wabaId: WABA_A,
      messageIdHash: hashOf(WAMID_1),
      messageType: 'text',
      occurredAt: new Date(1730000000 * 1000),
      bsuidHmac: null,
      piiHasPhone: true,
      keyVersion: 1,
    });
    expect(input.phoneHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const persisted = JSON.stringify(input);
    for (const secret of [CUSTOMER_PHONE, CONTACT_NAME, MESSAGE_TEXT, WAMID_1]) {
      expect(persisted).not.toContain(secret);
    }
    expect(ingestionLog()).toMatchObject({ capturedCount: 1, duplicateCount: 0 });
  });

  it('o envelope decifra com o contexto correto e devolve conteúdo e wamid', async () => {
    await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    const input = mocks.capture.mock.calls[0][0];
    const key = Buffer.from(CONTENT_KEY_HEX, 'hex');

    expect(decryptWhatsAppMessageContent({
      ciphertext: input.contentCiphertext, companyId: COMPANY_A, connectionId: CONN_A, messageIdHash: hashOf(WAMID_1), key,
    })).toEqual({
      wamid: WAMID_1,
      content: { kind: 'text', text: MESSAGE_TEXT, truncated: false },
      repliedToWamid: null,
    });
    expect(decryptWhatsAppContactPii({ ciphertext: input.piiCiphertext, companyId: COMPANY_A, piiRef: input.piiRef, key }))
      .toEqual({ phone: CUSTOMER_PHONE, bsuid: null, parentBsuid: null, displayName: CONTACT_NAME });
  });

  it('usuário só com BSUID captura sem telefone', async () => {
    const res = await POST(post(body(value(PHONE_A, {
      contacts: [{ profile: { name: CONTACT_NAME }, user_id: 'BR.13491208655302741918' }],
      messages: [message(WAMID_1, { from: undefined, from_user_id: 'BR.13491208655302741918' })],
    }))));
    expect(res.status).toBe(200);
    expect(mocks.capture.mock.calls[0][0]).toMatchObject({ phoneHmac: null, piiHasPhone: false });
    expect(mocks.capture.mock.calls[0][0].bsuidHmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tipo não suportado é capturado sem derrubar a entrega', async () => {
    const res = await POST(post(body(value(PHONE_A, {
      messages: [message(WAMID_1, { type: 'location', text: undefined, location: { latitude: 1 } }), message(WAMID_2)],
    }))));
    expect(res.status).toBe(200);
    expect(ingestionLog()).toMatchObject({ capturedCount: 2 });
    expect(mocks.capture.mock.calls[0][0].messageType).toBe('location');
  });

  it('mídia não é baixada', async () => {
    const res = await POST(post(body(value(PHONE_A, {
      messages: [message(WAMID_1, { type: 'image', text: undefined, image: { id: 'media123', mime_type: 'image/jpeg' } })],
    }))));
    expect(res.status).toBe(200);
    expect(ingestionLog()).toMatchObject({ capturedCount: 1 });
  });
});

describe('assinatura inválida', () => {
  it('403 antes de qualquer consulta', async () => {
    const raw = body(value(PHONE_A, { messages: [message(WAMID_1)] }));
    const res = await POST(new Request(ENDPOINT, { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': sign('outro corpo') } }));
    expect(res.status).toBe(403);
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('sem assinatura → 403', async () => {
    const res = await POST(new Request(ENDPOINT, { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
  });
});

describe('empresa desconhecida', () => {
  it('número sem conexão → nada gravado, 200 sem reentrega infinita', async () => {
    const res = await POST(post(body(value(PHONE_UNKNOWN, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'read')] }))));
    expect(res.status).toBe(200);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ unknownNumberCount: 2 });
  });

  it('corrida: conexão desconectada durante a entrega → 200 sem contar captura', async () => {
    mocks.capture.mockResolvedValue({ ok: true, outcome: 'connection_not_connected' });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(ingestionLog()).toMatchObject({ unknownNumberCount: 1, capturedCount: 0 });
  });
});

describe('WABA incompatível', () => {
  it.each([
    ['de outra conta', '999999999999999'],
    ['ausente', undefined],
    ['inválida', 'abc'],
  ])('WABA %s → nada gravado, 200', async (_label, wabaId) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry(wabaId, value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'read')] }))],
    });
    const res = await POST(post(raw));
    expect(res.status).toBe(200);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ wabaMismatchCount: 2, capturedCount: 0 });
  });

  it('recusa fica rastreada com a WABA da conexão, sem a recebida', async () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry('999999999999999', value(PHONE_A, { messages: [message(WAMID_1)] }))],
    });
    await POST(post(raw));
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed.mock.calls[0][0]).toMatchObject({
      errorCode: 'waba_mismatch', companyId: COMPANY_A, connectionId: CONN_A, wabaId: WABA_A, messageIdHash: hashOf(WAMID_1),
    });
    expect(JSON.stringify(mocks.markFailed.mock.calls[0][0])).not.toContain('999999999999999');
  });

  it('com captura desligada, a divergência não grava nada', async () => {
    captureAllowed[PHONE_A] = false;
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry('999999999999999', value(PHONE_A, { messages: [message(WAMID_1)] }))],
    });
    expect((await POST(post(raw))).status).toBe(200);
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ captureDisabledCount: 1, wabaMismatchCount: 0 });
  });

  it('falha ao rastrear a recusa → 503', async () => {
    mocks.markFailed.mockResolvedValue({ ok: false });
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry('999999999999999', value(PHONE_A, { messages: [message(WAMID_1)] }))],
    });
    expect((await POST(post(raw))).status).toBe(503);
  });

  it('banco detecta divergência mesmo após a checagem da aplicação', async () => {
    mocks.capture.mockResolvedValue({ ok: true, outcome: 'waba_mismatch' });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(ingestionLog()).toMatchObject({ wabaMismatchCount: 1 });
  });
});

describe('captura desabilitada por padrão', () => {
  it('conexão sem capture_enabled não grava mensagem nem status', async () => {
    captureAllowed[PHONE_A] = false;
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'read')] }))));
    expect(res.status).toBe(200);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ captureDisabledCount: 2 });
  });

  it('sem capture_enabled as chaves nem são exigidas', async () => {
    captureAllowed[PHONE_A] = false;
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', '');
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
  });

  it('gate desligado durante a entrega → 200 sem contar captura', async () => {
    mocks.capture.mockResolvedValue({ ok: true, outcome: 'capture_disabled' });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(200);
    expect(ingestionLog()).toMatchObject({ captureDisabledCount: 1, capturedCount: 0 });
  });
});

describe('mensagem duplicada e reentrega', () => {
  it('reentrega idêntica não cria segunda mensagem', async () => {
    const payload = body(value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'read')] }));
    expect((await POST(post(payload))).status).toBe(200);
    expect((await POST(post(payload))).status).toBe(200);
    expect(messages.size).toBe(1);
    expect(statuses.size).toBe(1);
    const lines = loggedJson().filter((l) => l.result === 'ingestion');
    expect(lines[0]).toMatchObject({ capturedCount: 1, registeredCount: 1, duplicateCount: 0 });
    expect(lines[1]).toMatchObject({ capturedCount: 0, registeredCount: 0, duplicateCount: 2 });
  });

  it('repetição dentro da mesma entrega só chama a RPC uma vez', async () => {
    await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_1)] }))));
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(ingestionLog()).toMatchObject({ capturedCount: 1, duplicateCount: 1 });
  });

  it('reentrega depois de falha captura exatamente uma vez', async () => {
    const payload = body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2)] }));
    mocks.capture.mockResolvedValueOnce({ ok: false });
    expect((await POST(post(payload))).status).toBe(503);
    expect(messages.size).toBe(1);
    expect((await POST(post(payload))).status).toBe(200);
    expect(messages.size).toBe(2);
  });

  it('cada reentrega usa envelope novo, mas o mesmo hash', async () => {
    const payload = body(value(PHONE_A, { messages: [message(WAMID_1)] }));
    await POST(post(payload));
    await POST(post(payload));
    const [first, second] = mocks.capture.mock.calls.map((c) => c[0]);
    expect(first.messageIdHash).toBe(second.messageIdHash);
    expect(first.phoneHmac).toBe(second.phoneHmac);
    expect(first.contentCiphertext).not.toBe(second.contentCiphertext);
  });
});

describe('concorrência', () => {
  it('entregas simultâneas da mesma mensagem geram uma única linha', async () => {
    const payload = body(value(PHONE_A, { messages: [message(WAMID_1)] }));
    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(post(payload))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(messages.size).toBe(1);
    const lines = loggedJson().filter((l) => l.result === 'ingestion');
    expect(lines.reduce((sum, l) => sum + Number(l.capturedCount), 0)).toBe(1);
    expect(lines.reduce((sum, l) => sum + Number(l.duplicateCount), 0)).toBe(4);
  });

  it('o contexto é resolvido uma vez por número em cada entrega, sem cache entre entregas', async () => {
    const payload = body(
      value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2)], statuses: [status(WAMID_OUT, 'read')] }),
    );
    await POST(post(payload));
    expect(mocks.loadContext).toHaveBeenCalledTimes(1);
    await POST(post(payload));
    expect(mocks.loadContext).toHaveBeenCalledTimes(2);
  });
});

describe('falha de persistência', () => {
  it('RPC falhou → 503, nunca 200', async () => {
    mocks.capture.mockResolvedValue({ ok: false });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(ingestionLog()).toMatchObject({ result: 'ingestion_infra_failure', capturedCount: 0 });
  });

  it('falha numa mensagem não impede as demais, mas a entrega volta 503', async () => {
    mocks.capture.mockResolvedValueOnce({ ok: false });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2)] }))));
    expect(res.status).toBe(503);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(messages.size).toBe(1);
  });

  it('exceção inesperada na captura → 503, sem vazar a mensagem do erro', async () => {
    mocks.capture.mockRejectedValue(new Error(`boom ${CUSTOMER_PHONE}`));
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(loggedText()).not.toContain('boom');
  });

  it('falha ao buscar a conexão → 503, sem captura; consultada uma vez', async () => {
    mocks.loadContext.mockResolvedValue({ ok: false });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1), message(WAMID_2)] }))));
    expect(res.status).toBe(503);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.loadContext).toHaveBeenCalledTimes(1);
  });

  it('falha de permissão no banco é tratada como falha: 503', async () => {
    mocks.loadContext.mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' }));
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(loggedText()).not.toContain('permission denied');
  });

  it('falha ao registrar status → 503', async () => {
    mocks.register.mockResolvedValue({ ok: false, code: 'register_failed' });
    const res = await POST(post(body(value(PHONE_A, { statuses: [status(WAMID_OUT, 'read')] }))));
    expect(res.status).toBe(503);
  });
});

describe('falha de criptografia', () => {
  it.each([
    ['WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', ''],
    ['WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'curta'],
    ['WHATSAPP_CONTACT_HMAC_KEY_V1', ''],
    ['WHATSAPP_CONTACT_HMAC_KEY_V1', 'C'.repeat(64)],
  ])('%s inválida com captura habilitada → 503 e nada gravado', async (name, keyValue) => {
    vi.stubEnv(name, keyValue);
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ result: 'ingestion_infra_failure' });
  });

  it('contexto inválido para o AAD → 503 e nada gravado', async () => {
    mocks.loadContext.mockResolvedValue({
      ok: true,
      value: { connectionId: 'nao-e-uuid', companyId: COMPANY_A, wabaId: WABA_A, captureAllowed: true },
    });
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(res.status).toBe(503);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('resultado desconhecido da RPC nunca vira 200', async () => {
    mocks.capture.mockResolvedValue({ ok: false });
    expect((await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))))).status).toBe(503);
  });
});

describe('isolamento multiempresa', () => {
  const multi = () => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      entry(WABA_A, value(PHONE_A, { messages: [message(WAMID_1)] })),
      entry(WABA_B, value(PHONE_B, { messages: [message(WAMID_1)] })),
    ],
  });

  it('dois números na mesma entrega: cada mensagem na sua empresa', async () => {
    const res = await POST(post(multi()));
    expect(res.status).toBe(200);
    expect(mocks.capture.mock.calls.map((c) => [c[0].phoneNumberId, c[0].companyId, c[0].connectionId])).toEqual([
      [PHONE_A, COMPANY_A, CONN_A],
      [PHONE_B, COMPANY_B, CONN_B],
    ]);
    expect(messages.size).toBe(2);
  });

  it('o mesmo telefone gera HMAC diferente em cada empresa', async () => {
    await POST(post(multi()));
    const [a, b] = mocks.capture.mock.calls.map((c) => c[0]);
    expect(a.phoneHmac).not.toBe(b.phoneHmac);
  });

  it('WABA de uma empresa não libera número de outra', async () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry(WABA_A, value(PHONE_B, { messages: [message(WAMID_1)] }))],
    });
    await POST(post(raw));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ wabaMismatchCount: 1 });
  });

  it('ciphertext de uma empresa não abre no contexto de outra', async () => {
    await POST(post(multi()));
    const a = mocks.capture.mock.calls[0][0];
    const key = Buffer.from(CONTENT_KEY_HEX, 'hex');
    expect(() => decryptWhatsAppMessageContent({
      ciphertext: a.contentCiphertext, companyId: COMPANY_B, connectionId: CONN_B, messageIdHash: a.messageIdHash, key,
    })).toThrow();
    expect(() => decryptWhatsAppContactPii({
      ciphertext: a.piiCiphertext, companyId: COMPANY_B, piiRef: a.piiRef, key,
    })).toThrow();
  });
});

describe('itens inválidos não derrubam a entrega', () => {
  it('sem contato: fica rastreado como falha, sem dado pessoal, e responde 200', async () => {
    const res = await POST(post(body(value(PHONE_A, {
      contacts: [],
      messages: [message(WAMID_1, { from: undefined }), message(WAMID_2)],
    }))));
    expect(res.status).toBe(200);
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed.mock.calls[0][0]).toMatchObject({
      errorCode: 'contact_unresolved', companyId: COMPANY_A, messageIdHash: hashOf(WAMID_1),
    });
    expect(ingestionLog()).toMatchObject({ capturedCount: 1, failedCount: 1 });
  });

  it('falha ao rastrear → 503', async () => {
    mocks.markFailed.mockResolvedValue({ ok: false });
    const res = await POST(post(body(value(PHONE_A, { contacts: [], messages: [message(WAMID_1, { from: undefined })] }))));
    expect(res.status).toBe(503);
  });

  it('sem id ou sem phone_number_id → inutilizável, sem consulta', async () => {
    const res = await POST(post(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [entry(WABA_A, { messages: [message(WAMID_1)] }, value(PHONE_A, { messages: [{ type: 'text' }] }))],
    })));
    expect(res.status).toBe(200);
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ unusableCount: 2 });
  });

  it('payload sem eventos com flag ON → sem consulta, mesmo resumo da W1', async () => {
    const res = await POST(post(JSON.stringify({ object: 'whatsapp_business_account', entry: [] })));
    expect(res.status).toBe(200);
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(loggedJson().map((l) => l.result)).toEqual(['ignored_no_events']);
  });
});

describe('mensagens de grupo', () => {
  const GROUP = 'Y2FwaV9ncm91cDoxNzA1NTU1MDEzOQZD';

  it('recusada com 200, rastreada e sem captura', async () => {
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1, { group_id: GROUP })] }))));
    expect(res.status).toBe(200);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.markFailed.mock.calls[0][0]).toMatchObject({ errorCode: 'group_message', messageIdHash: hashOf(WAMID_1) });
    expect(ingestionLog()).toMatchObject({ groupMessageCount: 1, capturedCount: 0, failedCount: 0 });
  });

  it('não vaza grupo, participante ou conteúdo', async () => {
    const response = await (await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1, { group_id: GROUP })] }))))).text();
    const input = JSON.stringify(mocks.markFailed.mock.calls);
    for (const secret of [GROUP, CUSTOMER_PHONE, CONTACT_NAME, MESSAGE_TEXT, WAMID_1]) {
      expect(input).not.toContain(secret);
      expect(loggedText()).not.toContain(secret);
      expect(response).not.toContain(secret);
    }
  });

  it('não impede a mensagem individual da mesma entrega', async () => {
    await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1, { group_id: GROUP }), message(WAMID_2)] }))));
    expect(ingestionLog()).toMatchObject({ groupMessageCount: 1, capturedCount: 1 });
    expect(messages.size).toBe(1);
  });

  it('com captura desligada não grava nada', async () => {
    captureAllowed[PHONE_A] = false;
    await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1, { group_id: GROUP })] }))));
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ captureDisabledCount: 1, groupMessageCount: 0 });
  });

  it('status de grupo só é contado', async () => {
    const res = await POST(post(body(value(PHONE_A, { statuses: [{ ...status(WAMID_OUT, 'sent'), recipient_type: 'group' }] }))));
    expect(res.status).toBe(200);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(ingestionLog()).toMatchObject({ groupMessageCount: 1 });
  });
});

describe('horários inválidos', () => {
  it.each([
    ['extremo', '999999999999'],
    ['anterior ao WhatsApp', '1000000000'],
  ])('%s vai sem horário para a RPC, é contado e responde 200', async (_label, timestamp) => {
    const res = await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1, { timestamp })] }))));
    expect(res.status).toBe(200);
    expect(mocks.capture.mock.calls[0][0].occurredAt).toBeNull();
    expect(ingestionLog()).toMatchObject({ capturedCount: 1, invalidTimestampCount: 1 });
  });
});

describe('statuses', () => {
  it('registrados na empresa certa, com o status bruto só no hash', async () => {
    await POST(post(body(value(PHONE_A, { statuses: [status(WAMID_OUT, 'delivered')] }))));
    const input = mocks.register.mock.calls[0][0];
    expect(input).toMatchObject({
      connectionId: CONN_A, companyId: COMPANY_A, eventKind: 'status', messageType: null, statusValue: 'delivered',
      messageIdHash: hashOf(WAMID_OUT),
    });
    expect(JSON.stringify(input)).not.toContain(WAMID_OUT);
    expect(JSON.stringify(input)).not.toContain(CUSTOMER_PHONE);
  });

  it('cada transição é um evento; desconhecidos distintos não colidem', async () => {
    await POST(post(body(value(PHONE_A, {
      statuses: [status(WAMID_OUT, 'sent'), status(WAMID_OUT, 'read'), status(WAMID_OUT, 'x_novo'), status(WAMID_OUT, 'y_novo')],
    }))));
    expect(statuses.size).toBe(4);
    expect(JSON.stringify(mocks.register.mock.calls)).not.toContain('x_novo');
  });
});

describe('ausência de dados pessoais', () => {
  it('nenhum dado sensível em logs ou respostas, em sucesso e em falha', async () => {
    const responses: string[] = [];
    const payload = body(
      value(PHONE_A, { messages: [message(WAMID_1)], statuses: [status(WAMID_OUT, 'failed')] }),
      value(PHONE_UNKNOWN, { messages: [message(WAMID_2)] }),
    );
    responses.push(await (await POST(post(payload))).text());
    mocks.capture.mockResolvedValue({ ok: false });
    responses.push(await (await POST(post(payload))).text());
    mocks.loadContext.mockResolvedValue({ ok: false });
    responses.push(await (await POST(post(payload))).text());

    const logged = loggedText();
    for (const secret of SENSITIVE) {
      expect(logged).not.toContain(secret);
      for (const response of responses) expect(response).not.toContain(secret);
    }
    expect(logged).not.toMatch(/[0-9a-f]{64}/);
    expect(logged).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);
  });

  it('as chaves são zeradas ao fim da entrega', async () => {
    const buffers: Buffer[] = [];
    const original = Buffer.from.bind(Buffer);
    vi.spyOn(Buffer, 'from').mockImplementation(((...args: Parameters<typeof Buffer.from>) => {
      const buffer = original(...args);
      if (args[0] === CONTENT_KEY_HEX || args[0] === HMAC_KEY_HEX) buffers.push(buffer);
      return buffer;
    }) as typeof Buffer.from);
    await POST(post(body(value(PHONE_A, { messages: [message(WAMID_1)] }))));
    expect(buffers.length).toBeGreaterThanOrEqual(2);
    for (const buffer of buffers) expect(buffer.every((byte) => byte === 0)).toBe(true);
  });
});

describe('Lead Ads sem regressão', () => {
  it('webhook do Lead Ads não importa nada do WhatsApp e o WhatsApp não importa ingestão Lead Ads', () => {
    const root = process.cwd();
    const metaFiles = ['app/api/webhooks/meta/route.ts', 'lib/server/meta-webhook/ingestion.ts',
      'lib/server/meta-webhook/env.ts', 'lib/server/meta-oauth/token-crypto.ts'];
    for (const file of metaFiles) {
      expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(/whatsapp/i);
    }
    const ingestion = readFileSync(resolve(root, 'lib/server/whatsapp-webhook/ingestion.ts'), 'utf8');
    expect(ingestion).not.toMatch(/meta-webhook|meta-oauth/);
  });
});
