// META-MVP1/MVP2 — POST /api/integrations/meta/leadgen-review/requeue. Auth e RPCs
// mockadas; o agendamento do processamento é mockado. Nenhuma rede, nenhum banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireAuthenticatedActor: vi.fn(),
  schedule: vi.fn(),
  enabled: { value: true },
  requeueReply: { value: { data: [{ out_outcome: 'requeued' }] as unknown, error: null as unknown } },
}));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...original, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});
vi.mock('@/lib/server/meta-webhook/schedule-leadgen-processing', () => ({
  scheduleManualRequeueProcessing: mocks.schedule,
}));

import { POST } from '@/app/api/integrations/meta/leadgen-review/requeue/route';

const APP_URL = 'https://crm.example.test';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = 'f9e00000-0000-4000-8000-000000000777';

function request(body: unknown, origin = APP_URL): Request {
  return new Request(`${APP_URL}/api/integrations/meta/leadgen-review/requeue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer fake-jwt' },
    body: JSON.stringify(body),
  });
}

const setRequeue = (data: unknown, error: unknown = null) => {
  mocks.requeueReply.value = { data, error };
};

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  mocks.enabled.value = true;
  setRequeue([{ out_outcome: 'requeued' }]);
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'meta_lead_ads_company_access') return { data: [{ enabled: mocks.enabled.value }], error: null };
    return mocks.requeueReply.value;
  });
  mocks.requireAuthenticatedActor.mockReset().mockResolvedValue({
    ok: true,
    actor: { profileId: 'p' },
    client: { rpc: mocks.rpc },
    jwt: 'fake-jwt',
  });
  mocks.schedule.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requeue', () => {
  it('sucesso: habilitação e reprocessamento lidos COMO o usuário; processamento agendado', async () => {
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'requeued', processingScheduled: true });
    expect(mocks.rpc).toHaveBeenCalledWith('meta_lead_ads_company_access', { p_company_id: COMPANY });
    expect(mocks.rpc).toHaveBeenCalledWith('meta_leadgen_event_requeue', { p_company_id: COMPANY, p_event_id: EVENT_ID });
    expect(mocks.schedule).toHaveBeenCalledWith(EVENT_ID);
  });

  it('ingestão desligada: reprocessa no ledger, mas não agenda processamento', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(await res.json()).toEqual({ ok: true, outcome: 'requeued', processingScheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'not_requeueable', 'requeue_limit', 'too_old'])('outcome %s não agenda nada', async (outcome) => {
    setRequeue([{ out_outcome: outcome }]);
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(await res.json()).toEqual({ ok: true, outcome, processingScheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('META-MVP2: empresa desabilitada → 403 sem chamar o reprocessamento', async () => {
    mocks.enabled.value = false;
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalledWith('meta_leadgen_event_requeue', expect.anything());
  });

  it('flag de Integrações desligada → 403', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('banco recusa o reprocessamento (forbidden) → 403, sem agendar', async () => {
    setRequeue(null, { message: 'forbidden' });
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('erro bruto do banco → 503 genérico, sem vazar', async () => {
    setRequeue(null, { message: 'relation secret_table' });
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret_table');
  });

  it('sem autenticação → 401', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false, error: 'unauthenticated' });
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(401);
  });

  it('Origin divergente → 403 antes de autenticar', async () => {
    const res = await POST(request({ company_id: COMPANY, event_id: EVENT_ID }, 'https://evil.test'));
    expect(res.status).toBe(403);
    expect(mocks.requireAuthenticatedActor).not.toHaveBeenCalled();
  });

  it.each([
    [{ company_id: COMPANY }],
    [{ company_id: 'x', event_id: EVENT_ID }],
    [{ company_id: COMPANY, event_id: EVENT_ID, extra: 1 }],
  ])('corpo inválido %j → 400', async (body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
  });
});
