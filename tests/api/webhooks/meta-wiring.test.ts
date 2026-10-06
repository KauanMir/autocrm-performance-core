// Wiring do webhook com o processor (P2.4): rota e ingestão reais; RPCs, waitUntil
// e processor mockados. Nenhuma rede, nenhum Graph, nenhum banco.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_TEST_COMPANY_ID, META_TEST_PAGE_ID } from '@/lib/server/meta-oauth/config';

const mocks = vi.hoisted(() => ({
  ownerByPage: vi.fn(),
  register: vi.fn(),
  processMetaLeadgenEvent: vi.fn(),
  createMetaLeadgenProcessorDeps: vi.fn(() => ({})),
  waitUntil: vi.fn(),
  captured: [] as Promise<unknown>[],
}));

vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/server/meta-oauth/connection-rpc', () => ({
  createMetaConnectionRpcPort: () => ({ ownerByPage: mocks.ownerByPage }),
}));
vi.mock('@/lib/server/meta-webhook/leadgen-events-rpc', () => ({ registerLeadgenEvent: mocks.register }));
vi.mock('@/lib/server/meta-webhook/process-leadgen-event', () => ({
  processMetaLeadgenEvent: mocks.processMetaLeadgenEvent,
  createMetaLeadgenProcessorDeps: mocks.createMetaLeadgenProcessorDeps,
}));

import { POST } from '@/app/api/webhooks/meta/route';

const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/meta';
const LEADGEN = '9990001112223350';
const EVENT_ID = 'f9e00000-0000-0000-0000-000000000350';
const INTEGRATION_ID = 'f9a00000-0000-0000-0000-00000000035a';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;
}

function pageBody(pageId = META_TEST_PAGE_ID, field = 'leadgen'): string {
  return JSON.stringify({
    object: 'page',
    entry: [
      {
        id: pageId,
        time: 1,
        changes: [
          {
            field,
            value: { page_id: pageId, form_id: '7778889990001112', leadgen_id: LEADGEN, created_time: 1 },
          },
        ],
      },
    ],
  });
}

function post(body: string): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) },
  });
}

function ownerRow(companyId = META_TEST_COMPANY_ID) {
  return {
    data: [{ integration_id: INTEGRATION_ID, company_id: companyId, page_id: META_TEST_PAGE_ID, status: 'connected' }],
    error: null,
  };
}

const registered = { ok: true as const, value: { eventId: EVENT_ID, status: 'received', created: true } };
const alreadyExists = { ok: true as const, value: { eventId: EVENT_ID, status: 'processed', created: false } };

beforeEach(() => {
  vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', 'fake-verify-token-for-tests-only');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  mocks.ownerByPage.mockReset().mockResolvedValue(ownerRow());
  mocks.register.mockReset().mockResolvedValue(registered);
  mocks.processMetaLeadgenEvent.mockReset().mockResolvedValue({ outcome: 'created' });
  mocks.createMetaLeadgenProcessorDeps.mockReset().mockImplementation(() => ({}));
  mocks.captured.length = 0;
  mocks.waitUntil.mockReset().mockImplementation((p: Promise<unknown>) => {
    mocks.captured.push(p);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await Promise.all(mocks.captured);
}

describe('flag OFF', () => {
  it('A. zero owner lookup, zero register, zero processor, zero waitUntil; 200', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPage).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.processMetaLeadgenEvent).not.toHaveBeenCalled();
  });
});

describe('isolamento de pilots e companies', () => {
  it('B. Page diferente da Page de teste → zero register, zero waitUntil, 200', async () => {
    const res = await POST(post(pageBody('1234567890')));
    expect(res.status).toBe(200);
    expect(mocks.ownerByPage).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('B2. dono de outra company na Page de teste → zero register, zero waitUntil, 200', async () => {
    mocks.ownerByPage.mockResolvedValue(ownerRow('f9eeeeee-2222-2222-2222-222222222222'));
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.processMetaLeadgenEvent).not.toHaveBeenCalled();
  });
});

describe('eventos ineligíveis', () => {
  it('C. objeto não-page → 200, zero waitUntil', async () => {
    const body = JSON.stringify({ object: 'user', entry: [] });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('C2. page sem change leadgen → 200, zero waitUntil', async () => {
    const res = await POST(post(pageBody(META_TEST_PAGE_ID, 'feed')));
    expect(res.status).toBe(200);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('C3. JSON inválido → 400, zero waitUntil', async () => {
    const res = await POST(post('{not json'));
    expect(res.status).toBe(400);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('C4. assinatura inválida → 403, zero waitUntil', async () => {
    const body = pageBody();
    const req = new Request(ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
});

describe('ordem register → waitUntil', () => {
  it('D. register infra failure → 503, zero waitUntil, zero processor, corpo genérico', async () => {
    mocks.register.mockResolvedValue({ ok: false, code: 'register_failed' });
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('service unavailable');
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.processMetaLeadgenEvent).not.toHaveBeenCalled();
  });

  it('E. register created → 200 e waitUntil exatamente 1 vez com o event id interno', async () => {
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    await settle();
    expect(mocks.processMetaLeadgenEvent).toHaveBeenCalledTimes(1);
    expect(mocks.processMetaLeadgenEvent.mock.calls[0][0]).toBe(EVENT_ID);
  });

  it('F. register already_exists → 200 e waitUntil exatamente 1 vez', async () => {
    mocks.register.mockResolvedValue(alreadyExists);
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('o event id não aparece na resposta', async () => {
    const res = await POST(post(pageBody()));
    expect(await res.text()).not.toContain(EVENT_ID);
  });
});

describe('resultado do processor não altera a resposta', () => {
  it.each([
    ['created', { outcome: 'created' }],
    ['linked_existing', { outcome: 'linked_existing' }],
    ['failed', { outcome: 'failed', errorCode: 'graph_timeout' }],
    ['infrastructure_error', { outcome: 'infrastructure_error' }],
    ['lease_lost', { outcome: 'lease_lost' }],
    ['not_claimed', { outcome: 'not_claimed' }],
  ])('G-K. processor %s → webhook 200', async (_label, result) => {
    mocks.processMetaLeadgenEvent.mockResolvedValue(result);
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await settle();
    expect(mocks.processMetaLeadgenEvent).toHaveBeenCalledTimes(1);
  });

  it('L. processor lança exceção inesperada → 200, promise do waitUntil resolve, nada vaza', async () => {
    mocks.processMetaLeadgenEvent.mockRejectedValue(new Error('internal secret detail'));
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await expect(Promise.all(mocks.captured)).resolves.toEqual([undefined]);
    expect(console.error).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logged).not.toContain('secret');
  });

  it('L2. falha ao montar as dependências do processor → 200, sem vazamento', async () => {
    mocks.createMetaLeadgenProcessorDeps.mockImplementation(() => {
      throw new Error('supabase_admin_client_misconfigured');
    });
    const res = await POST(post(pageBody()));
    expect(res.status).toBe(200);
    await expect(Promise.all(mocks.captured)).resolves.toBeDefined();
    expect(mocks.processMetaLeadgenEvent).not.toHaveBeenCalled();
  });
});

describe('múltiplos changes com falha parcial', () => {
  const twoChangesBody = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: META_TEST_PAGE_ID,
        time: 1,
        changes: [
          {
            field: 'leadgen',
            value: { page_id: META_TEST_PAGE_ID, form_id: '7778889990001112', leadgen_id: '9990001112223351', created_time: 1 },
          },
          {
            field: 'leadgen',
            value: { page_id: META_TEST_PAGE_ID, form_id: '7778889990001112', leadgen_id: '9990001112223352', created_time: 1 },
          },
        ],
      },
    ],
  });

  it('1º change registrado e agendado; 2º falha no register → 503; sem rollback do 1º', async () => {
    const firstEvent = 'f9e00000-0000-0000-0000-000000000351';
    mocks.register
      .mockReset()
      .mockResolvedValueOnce({ ok: true, value: { eventId: firstEvent, status: 'received', created: true } })
      .mockResolvedValueOnce({ ok: false, code: 'register_failed' });

    const res = await POST(post(twoChangesBody));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('service unavailable');
    expect(mocks.register).toHaveBeenCalledTimes(2);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    await settle();
    expect(mocks.processMetaLeadgenEvent.mock.calls.map((c) => c[0])).toEqual([firstEvent]);
  });

  it('retry da Meta: ambos registrados (ledger deduplica o 1º); ambos agendados; 200', async () => {
    const firstEvent = 'f9e00000-0000-0000-0000-000000000351';
    const secondEvent = 'f9e00000-0000-0000-0000-000000000352';
    mocks.register
      .mockReset()
      .mockResolvedValueOnce({ ok: true, value: { eventId: firstEvent, status: 'processed', created: false } })
      .mockResolvedValueOnce({ ok: true, value: { eventId: secondEvent, status: 'received', created: true } });

    const res = await POST(post(twoChangesBody));
    expect(res.status).toBe(200);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(2);
    await settle();
    expect(mocks.processMetaLeadgenEvent.mock.calls.map((c) => c[0])).toEqual([firstEvent, secondEvent]);
  });
});

describe('webhook duplicado', () => {
  it('M. duas entregas do mesmo evento → duas tentativas agendadas, ambas 200; claim decide quem processa', async () => {
    mocks.register.mockResolvedValueOnce(registered).mockResolvedValueOnce(alreadyExists);
    const first = await POST(post(pageBody()));
    const second = await POST(post(pageBody()));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledTimes(2);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(2);
    await settle();
    expect(mocks.processMetaLeadgenEvent.mock.calls.map((c) => c[0])).toEqual([EVENT_ID, EVENT_ID]);
  });
});
