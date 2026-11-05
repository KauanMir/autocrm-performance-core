// META-MVP1 — POST /api/integrations/meta/leadgen-review/requeue. Auth e RPC
// mockadas; o agendamento do processamento é mockado. Nenhuma rede, nenhum banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireAuthenticatedActor: vi.fn(),
  schedule: vi.fn(),
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
const EVENT_ID = 'f9e00000-0000-4000-8000-000000000777';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';

function request(body: unknown, origin = APP_URL): Request {
  return new Request(`${APP_URL}/api/integrations/meta/leadgen-review/requeue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer fake-jwt' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ out_outcome: 'requeued' }], error: null });
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
  it('sucesso: RPC chamada COMO o usuário e processamento agendado', async () => {
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'requeued', processingScheduled: true });
    expect(mocks.rpc).toHaveBeenCalledWith('meta_leadgen_event_requeue', { p_company_id: META_TEST_COMPANY_ID, p_event_id: EVENT_ID });
    expect(mocks.schedule).toHaveBeenCalledWith(EVENT_ID);
  });

  it('ingestão desligada: reprocessa no ledger, mas não agenda processamento', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(await res.json()).toEqual({ ok: true, outcome: 'requeued', processingScheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'not_requeueable', 'requeue_limit', 'too_old'])('outcome %s não agenda nada', async (outcome) => {
    mocks.rpc.mockResolvedValue({ data: [{ out_outcome: outcome }], error: null });
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(await res.json()).toEqual({ ok: true, outcome, processingScheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('company que não é a de teste → 403 sem chamar a RPC (restrição do MVP-1)', async () => {
    const res = await POST(request({ company_id: OTHER_COMPANY, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('flag de review desligada → 403', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
  });

  it('banco recusa (forbidden) → 403, sem agendar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('erro bruto do banco → 503 genérico, sem vazar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation secret_table' } });
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret_table');
  });

  it('sem autenticação → 401', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false, error: 'unauthenticated' });
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }));
    expect(res.status).toBe(401);
  });

  it('Origin divergente → 403 antes de autenticar', async () => {
    const res = await POST(request({ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID }, 'https://evil.test'));
    expect(res.status).toBe(403);
    expect(mocks.requireAuthenticatedActor).not.toHaveBeenCalled();
  });

  it.each([
    [{ company_id: META_TEST_COMPANY_ID }],
    [{ company_id: 'x', event_id: EVENT_ID }],
    [{ company_id: META_TEST_COMPANY_ID, event_id: EVENT_ID, extra: 1 }],
  ])('corpo inválido %j → 400', async (body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
  });
});
