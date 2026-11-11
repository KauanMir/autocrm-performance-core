// @vitest-environment node
// Unidade: sincronização KAPA Leads → CRM (configuração, assinatura, cliente, normalização e ciclo).
// Sem rede e sem banco: fetch e RPC são falsos. Dados pessoais fictícios.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readKapaLeadsSyncConfig } from '@/lib/server/kapa-leads-sync/env';
import { signatureMessage, signedHeaders } from '@/lib/server/kapa-leads-sync/signature';
import { fetchLeadsPage, parseExportedLead, type ExportedLead } from '@/lib/server/kapa-leads-sync/client';
import { buildAnswers, normalizePhone, toIngestItem } from '@/lib/server/kapa-leads-sync/normalize';
import { runKapaLeadsSync } from '@/lib/server/kapa-leads-sync/run-sync';

const SECRET = 'k'.repeat(40);
const STORE = '11111111-1111-4111-8111-111111111111';
const CONFIG = { baseUrl: 'https://leads.example.test', secret: SECRET };
const CURSOR = { createdAt: '2026-11-11T14:00:00.123456+00:00', id: '00000000-0000-0000-0000-000000000000' };
const NOW = Date.parse('2026-11-11T15:00:00Z');

function exported(overrides: Partial<ExportedLead> = {}): ExportedLead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    storeId: STORE,
    campaign: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', slug: 'fabrica-de-aprovacao', name: 'Fábrica de Aprovação' },
    createdAt: '2026-11-11T14:30:00.654321+00:00',
    contact: { name: '  Maria   Teste ', phone: '62900000001', email: ' Maria@Example.TEST ' },
    formData: { hasTradeIn: true, hasDriversLicense: false, downPaymentCents: 1500000, note: null, vehicleModel: 'Onix LT' },
    formLabels: { hasTradeIn: { label: 'Possui veículo na troca', format: 'boolean' }, downPaymentCents: { label: 'Valor da entrada', format: 'money' } },
    consent: { version: '2026-10-v1', at: '2026-11-11T14:30:00.654321+00:00' },
    tracking: { utmSource: 'instagram', utmMedium: 'cpc', utmCampaign: 'fabrica-nov', utmContent: null, utmTerm: null, pageUrl: 'https://fabrica.example.test/', referrer: null },
    illustrative: { amountCents: 5475000, presentedAt: '2026-11-11T14:30:00.654321+00:00', expiresAt: '2026-11-13T02:30:00.654321+00:00' },
    cpfCooldownUntil: '2026-11-26T03:00:00+00:00',
    ...overrides,
  };
}

const okResponse = (items: unknown[], hasMore = false) => {
  const last = items.at(-1) as ExportedLead | undefined;
  return new Response(JSON.stringify({
    success: true, items, hasMore,
    nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

describe('config', () => {
  it('is off unless explicitly enabled and complete', () => {
    expect(readKapaLeadsSyncConfig({})).toEqual({ ok: false, reason: 'disabled' });
    expect(readKapaLeadsSyncConfig({ KAPA_LEADS_SYNC_ENABLED: '1' })).toEqual({ ok: false, reason: 'disabled' });
    expect(readKapaLeadsSyncConfig({ KAPA_LEADS_SYNC_ENABLED: 'true' })).toEqual({ ok: false, reason: 'api_url_missing' });
    expect(readKapaLeadsSyncConfig({ KAPA_LEADS_SYNC_ENABLED: 'true', KAPA_LEADS_API_URL: 'https://x.test' })).toEqual({ ok: false, reason: 'secret_missing' });
    expect(readKapaLeadsSyncConfig({ KAPA_LEADS_SYNC_ENABLED: 'true', KAPA_LEADS_API_URL: 'https://x.test', KAPA_LEADS_SYNC_SECRET: 'short' })).toEqual({ ok: false, reason: 'secret_too_short' });
    expect(readKapaLeadsSyncConfig({ KAPA_LEADS_SYNC_ENABLED: 'true', KAPA_LEADS_API_URL: 'https://x.test/', KAPA_LEADS_SYNC_SECRET: SECRET }))
      .toEqual({ ok: true, config: { baseUrl: 'https://x.test', secret: SECRET } });
  });

  it('accepts http only on loopback outside Vercel, and never a path or credentials', () => {
    const base = { KAPA_LEADS_SYNC_ENABLED: 'true', KAPA_LEADS_SYNC_SECRET: SECRET };
    expect(readKapaLeadsSyncConfig({ ...base, KAPA_LEADS_API_URL: 'http://127.0.0.1:3901' }).ok).toBe(true);
    expect(readKapaLeadsSyncConfig({ ...base, KAPA_LEADS_API_URL: 'http://127.0.0.1:3901', VERCEL_ENV: 'production' })).toEqual({ ok: false, reason: 'api_url_invalid' });
    expect(readKapaLeadsSyncConfig({ ...base, KAPA_LEADS_API_URL: 'http://leads.example.test' })).toEqual({ ok: false, reason: 'api_url_invalid' });
    expect(readKapaLeadsSyncConfig({ ...base, KAPA_LEADS_API_URL: 'https://x.test/api' })).toEqual({ ok: false, reason: 'api_url_invalid' });
    expect(readKapaLeadsSyncConfig({ ...base, KAPA_LEADS_API_URL: 'https://u:p@x.test' })).toEqual({ ok: false, reason: 'api_url_invalid' });
  });
});

describe('signature', () => {
  it('matches the v1 contract of the KAPA Leads platform', () => {
    const headers = signedHeaders(SECRET, 'get', '/api/x?a=1', NOW);
    expect(headers['X-Kapa-Timestamp']).toBe(String(NOW / 1000));
    const expected = createHmac('sha256', SECRET).update(`v1:${NOW / 1000}:GET:/api/x?a=1`).digest('hex');
    expect(headers['X-Kapa-Signature']).toBe(`v1=${expected}`);
    expect(signatureMessage('1', 'get', '/p')).toBe('v1:1:GET:/p');
  });
});

describe('fetchLeadsPage', () => {
  it('sends a signed GET with the cursor and parses the page', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return okResponse([exported()]);
    }) as unknown as typeof fetch;
    const result = await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl, nowMs: NOW });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://leads.example.test/api/integrations/crm/leads');
    expect(Object.fromEntries(url.searchParams)).toEqual({ storeId: STORE, afterCreatedAt: CURSOR.createdAt, afterId: CURSOR.id, limit: '50' });
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.redirect).toBe('error');
    const headers = calls[0].init?.headers as Record<string, string>;
    const expected = createHmac('sha256', SECRET).update(`v1:${NOW / 1000}:GET:${url.pathname}${url.search}`).digest('hex');
    expect(headers['X-Kapa-Signature']).toBe(`v1=${expected}`);
  });

  it.each([
    [401, 'source_unauthorized'], [403, 'source_store_not_allowed'], [404, 'source_export_disabled'],
    [429, 'source_rate_limited'], [500, 'source_server_error'], [302, 'source_unexpected_status'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const fetchImpl = (async () => new Response('{}', { status })) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl })).toEqual({ ok: false, code });
  });

  it('maps network errors and timeouts', async () => {
    const network = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl: network })).toEqual({ ok: false, code: 'source_network' });
    const hang = ((_: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl: hang, timeoutMs: 5 })).toEqual({ ok: false, code: 'source_timeout' });
  });

  it('rejects the whole page when any item is off-contract or from another store', async () => {
    const bad = (async () => okResponse([exported(), { ...exported(), id: 'not-a-uuid' }])) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl: bad })).toEqual({ ok: false, code: 'source_invalid_item' });
    const other = (async () => okResponse([exported({ storeId: '22222222-2222-4222-8222-222222222222' })])) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl: other })).toEqual({ ok: false, code: 'source_store_mismatch' });
  });

  it('rejects a cursor that does not match the last item', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      success: true, hasMore: false, items: [exported()], nextCursor: { createdAt: CURSOR.createdAt, id: CURSOR.id },
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLeadsPage({ config: CONFIG, storeId: STORE, cursor: CURSOR, fetchImpl })).toEqual({ ok: false, code: 'source_invalid_body' });
  });
});

describe('parseExportedLead', () => {
  it('refuses nested objects in formData', () => {
    expect(parseExportedLead({ ...exported(), formData: { a: { b: 1 } } })).toBeNull();
    expect(parseExportedLead(exported())).not.toBeNull();
  });
});

describe('normalize', () => {
  it('builds a validated payload with origin, simulation, consent and attribution', () => {
    const item = toIngestItem(exported(), 'vehicleModel');
    expect(item).toMatchObject({
      source_lead_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      store_id: STORE,
      source_campaign_slug: 'fabrica-de-aprovacao',
      payload: {
        contact: { name: 'Maria Teste', phone: '62900000001', email: 'maria@example.test' },
        vehicle: 'Onix LT',
        source_label: 'Fábrica de Aprovação (KAPA Leads)',
      },
    });
    const answers = Object.fromEntries(item.payload.answers.map((a) => [a.key, a.values[0]]));
    expect(answers['Campanha']).toBe('Fábrica de Aprovação');
    expect(answers['Possui veículo na troca']).toBe('Sim');
    expect(answers['hasDriversLicense']).toBe('Não');
    expect(answers['Valor da entrada']).toMatch(/R\$\s?15\.000,00/);
    expect(answers['Valor ilustrativo apresentado']).toMatch(/R\$\s?54\.750,00 \(ilustrativo/);
    expect(answers['Validade do valor ilustrativo']).toBe('12/11/2026, 23:30');
    expect(answers['Consentimento']).toBe('Versão 2026-10-v1, aceito em 11/11/2026, 11:30');
    expect(answers['utm_source']).toBe('instagram');
    expect(answers['ID no KAPA Leads']).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect('note' in answers).toBe(false);
  });

  it('labels known simulation keys and keeps the answers inside the database limits', () => {
    const formData: ExportedLead['formData'] = { simulationFinancedAmountCents: 5000000, simulationMonthlyRateBps: 190, simulation48Cents: 159710, simulationSelectedTerm: 48 };
    for (let i = 0; i < 80; i += 1) formData[`extra${i}`] = 'x'.repeat(2000);
    const answers = buildAnswers(exported({ formData, formLabels: {} }));
    expect(answers.length).toBeLessThanOrEqual(50);
    const map = Object.fromEntries(answers.map((a) => [a.key, a.values[0]]));
    expect(map['Valor a financiar (simulação)']).toMatch(/50\.000,00/);
    expect(map['Taxa mensal (simulação)']).toBe('1,90% a.m.');
    expect(map['Parcela em 48 meses (simulação)']).toMatch(/1\.597,10/);
    expect(map['Prazo escolhido (meses)']).toBe('48');
    for (const a of answers) {
      expect(a.key.length).toBeGreaterThanOrEqual(1);
      expect(a.key.length).toBeLessThanOrEqual(100);
      expect(a.values[0].length).toBeLessThanOrEqual(1000);
    }
  });

  it('normalizes phones and ignores a missing vehicle key', () => {
    expect(normalizePhone('5562900000001')).toBe('62900000001');
    expect(normalizePhone('(62) 90000-0001')).toBe('62900000001');
    expect(toIngestItem(exported(), null).payload.vehicle).toBeNull();
    expect(toIngestItem(exported(), 'hasTradeIn').payload.vehicle).toBeNull();
  });
});

describe('runKapaLeadsSync', () => {
  type Call = { fn: string; args?: Record<string, unknown> };
  function fakeSupabase(responses: Partial<Record<string, (args?: Record<string, unknown>) => unknown>>) {
    const calls: Call[] = [];
    const client = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        const handler = responses[fn];
        if (!handler) return { data: null, error: null };
        const out = handler(args);
        return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
      },
    };
    return { client, calls };
  }
  const link = { link_id: 'l1', company_id: 'c1', kapa_store_id: STORE, vehicle_form_key: null, cursor_created_at: CURSOR.createdAt, cursor_lead_id: CURSOR.id };
  const processIdle = () => [{ out_status: 'ok', out_created: 0, out_linked: 0, out_retry: 0, out_failed: 0, out_held: 0 }];

  it('ingests with compare-and-set on the cursor, then processes the queue', async () => {
    const { client, calls } = fakeSupabase({
      kapa_leads_links_for_poll: () => [link],
      kapa_leads_ingest_page: () => [{ out_outcome: 'ok', out_inserted: 1, out_duplicates: 0, out_invalid: 0 }],
      kapa_leads_process_pending: () => [{ out_status: 'ok', out_created: 1, out_linked: 0, out_retry: 0, out_failed: 0, out_held: 0 }],
      kapa_leads_purge_expired: () => 0,
    });
    const fetchImpl = (async () => okResponse([exported()])) as unknown as typeof fetch;
    const summary = await runKapaLeadsSync({ supabase: client as never, config: CONFIG, fetchImpl, now: () => NOW });
    expect(summary).toMatchObject({ links: 1, pages: 1, received: 1, created: 1, sourceErrors: 0 });
    const ingest = calls.find((c) => c.fn === 'kapa_leads_ingest_page')!;
    expect(ingest.args).toMatchObject({
      p_link_id: 'l1',
      p_expected_cursor_created_at: CURSOR.createdAt,
      p_expected_cursor_lead_id: CURSOR.id,
      p_next_cursor_created_at: '2026-11-11T14:30:00.654321+00:00',
      p_next_cursor_lead_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });

  it('records a source failure without moving the cursor', async () => {
    const { client, calls } = fakeSupabase({
      kapa_leads_links_for_poll: () => [link],
      kapa_leads_process_pending: processIdle,
    });
    const fetchImpl = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const summary = await runKapaLeadsSync({ supabase: client as never, config: CONFIG, fetchImpl, now: () => NOW });
    expect(summary.sourceErrors).toBe(1);
    expect(calls.some((c) => c.fn === 'kapa_leads_ingest_page')).toBe(false);
    expect(calls.find((c) => c.fn === 'kapa_leads_link_record_failure')?.args).toEqual({ p_link_id: 'l1', p_error_code: 'source_server_error' });
  });

  it('follows hasMore with the new cursor and stops on a conflict', async () => {
    let page = 0;
    const second = exported({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', createdAt: '2026-11-11T14:31:00+00:00' });
    const { client, calls } = fakeSupabase({
      kapa_leads_links_for_poll: () => [link],
      kapa_leads_ingest_page: () => (page === 1
        ? [{ out_outcome: 'ok', out_inserted: 1, out_duplicates: 0, out_invalid: 0 }]
        : [{ out_outcome: 'cursor_conflict', out_inserted: 0, out_duplicates: 0, out_invalid: 0 }]),
      kapa_leads_process_pending: processIdle,
    });
    const fetchImpl = (async () => { page += 1; return page === 1 ? okResponse([exported()], true) : okResponse([second], true); }) as unknown as typeof fetch;
    const summary = await runKapaLeadsSync({ supabase: client as never, config: CONFIG, fetchImpl, now: () => NOW });
    const ingests = calls.filter((c) => c.fn === 'kapa_leads_ingest_page');
    expect(ingests).toHaveLength(2);
    expect(ingests[1].args?.p_expected_cursor_lead_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(summary.cursorConflicts).toBe(1);
  });

  it('does not loop forever on an always-full page (5 pages max per cycle)', async () => {
    const { client, calls } = fakeSupabase({
      kapa_leads_links_for_poll: () => [link],
      kapa_leads_ingest_page: () => [{ out_outcome: 'ok', out_inserted: 1, out_duplicates: 0, out_invalid: 0 }],
      kapa_leads_process_pending: processIdle,
    });
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return okResponse([exported({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`, createdAt: `2026-11-11T14:3${n}:00+00:00` })], true);
    }) as unknown as typeof fetch;
    await runKapaLeadsSync({ supabase: client as never, config: CONFIG, fetchImpl, now: () => NOW });
    expect(calls.filter((c) => c.fn === 'kapa_leads_ingest_page')).toHaveLength(5);
  });
});

describe('cron route', () => {
  it('requires CRON_SECRET and stays disabled by default', async () => {
    const { GET } = await import('@/app/api/cron/kapa-leads-sync/route');
    const previous = { cron: process.env.CRON_SECRET, flag: process.env.KAPA_LEADS_SYNC_ENABLED };
    process.env.CRON_SECRET = 'c'.repeat(40);
    delete process.env.KAPA_LEADS_SYNC_ENABLED;
    try {
      expect((await GET(new Request('http://x/api/cron/kapa-leads-sync'))).status).toBe(401);
      expect((await GET(new Request('http://x/api/cron/kapa-leads-sync', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
      const res = await GET(new Request('http://x/api/cron/kapa-leads-sync', { headers: { authorization: `Bearer ${'c'.repeat(40)}` } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'disabled' });
      process.env.KAPA_LEADS_SYNC_ENABLED = 'true';
      const misconfigured = await GET(new Request('http://x/api/cron/kapa-leads-sync', { headers: { authorization: `Bearer ${'c'.repeat(40)}` } }));
      expect(await misconfigured.json()).toEqual({ status: 'misconfigured' });
    } finally {
      if (previous.cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous.cron;
      if (previous.flag === undefined) delete process.env.KAPA_LEADS_SYNC_ENABLED; else process.env.KAPA_LEADS_SYNC_ENABLED = previous.flag;
    }
  });
});

describe('UI helpers', () => {
  it('labels the submission source and flags a stale link', async () => {
    const { sourceTitle } = await import('@/components/leads/LeadFormSubmissionsSection');
    const { isStale } = await import('@/components/integrations/KapaLeadsSyncPanel');
    expect(sourceTitle({ source: 'kapa_leads', sourceDetail: 'Fábrica de Aprovação (KAPA Leads)' })).toBe('Fábrica de Aprovação (KAPA Leads)');
    expect(sourceTitle({ source: null, sourceDetail: null })).toBe('Meta Lead Ads');
    const base = {
      linkId: 'l', kapaStoreId: STORE, storeLabel: 'RCAR', vehicleFormKey: null, enabled: true, activatedAt: '2026-11-11T14:00:00Z',
      lastPolledAt: null, lastSuccessAt: '2026-11-11T14:50:00Z', lastErrorCode: null, consecutiveFailures: 0,
      pendingCount: 0, failedCount: 0, processed7d: 0, oldestPendingAt: null, lastProcessedAt: null,
    };
    expect(isStale(base, NOW)).toBe(false);
    expect(isStale({ ...base, lastSuccessAt: '2026-11-11T14:40:00Z' }, NOW)).toBe(true);
    expect(isStale({ ...base, enabled: false, lastSuccessAt: null }, NOW)).toBe(false);
  });
});
