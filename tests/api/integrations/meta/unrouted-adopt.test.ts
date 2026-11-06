// META-MVP2 — POST /api/integrations/meta/leadgen-review/unrouted-adopt.
// Auth e agendamento mockados; nenhuma rede, nenhum banco. A regra de negócio
// (Super Admin, Página conectada, empresa habilitada) fica no banco: pgTAP 91 e
// tests/integration/meta/mvp2-multicompany-local.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAuthenticatedActor: vi.fn(), rpc: vi.fn(), schedule: vi.fn() }));

vi.mock('@/lib/server/invites/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/invites/http')>()),
  requireAuthenticatedActor: mocks.requireAuthenticatedActor,
}));
vi.mock('@/lib/server/meta-webhook/schedule-leadgen-processing', () => ({ scheduleUnroutedAdoptionSweep: mocks.schedule }));

import { POST } from '@/app/api/integrations/meta/leadgen-review/unrouted-adopt/route';

const APP_URL = 'https://crm.example.test';
const COMPANY = '66666666-6666-4666-8666-66666666666a';
const PAGE = '960000000000001';

function request(body: unknown, origin = APP_URL): Request {
  return new Request(`${APP_URL}/api/integrations/meta/leadgen-review/unrouted-adopt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer jwt' },
    body: JSON.stringify(body),
  });
}

const reply = (outcome: string, adopted = 0) => ({ data: [{ out_outcome: outcome, out_adopted: adopted, out_already_registered: 0 }], error: null });

beforeEach(() => {
  vi.stubEnv('APP_URL', APP_URL);
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
  mocks.rpc.mockReset().mockResolvedValue(reply('adopted', 2));
  mocks.schedule.mockReset();
  mocks.requireAuthenticatedActor.mockReset().mockResolvedValue({ ok: true, actor: { profileId: 'u1' }, client: { rpc: mocks.rpc }, jwt: 'jwt' });
});

afterEach(() => vi.unstubAllEnvs());

describe('POST unrouted-adopt', () => {
  it('libera como o usuário e agenda o processamento', async () => {
    const res = await POST(request({ company_id: COMPANY, page_id: PAGE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'adopted', adopted: 2, processingScheduled: true });
    expect(mocks.rpc).toHaveBeenCalledWith('meta_leadgen_unrouted_adopt', { p_company_id: COMPANY, p_page_id: PAGE });
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it('ingestão desligada: libera sem agendar', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'false');
    expect(await (await POST(request({ company_id: COMPANY, page_id: PAGE }))).json()).toMatchObject({ processingScheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each(['nothing_pending', 'not_connected', 'company_disabled', 'owner_conflict'])('resultado %s: não agenda nada', async (outcome) => {
    mocks.rpc.mockResolvedValue(reply(outcome));
    expect(await (await POST(request({ company_id: COMPANY, page_id: PAGE }))).json()).toMatchObject({ ok: true, outcome, adopted: 0 });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('banco recusa (não é Super Admin) → 403', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }))).status).toBe(403);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('erro bruto do banco nunca volta ao cliente', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'detalhe interno do banco' } });
    const res = await POST(request({ company_id: COMPANY, page_id: PAGE }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('detalhe interno');
  });

  it('transporte falhou → 503', async () => {
    mocks.rpc.mockRejectedValue(new Error('rede'));
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }))).status).toBe(503);
  });

  it('resultado fora do catálogo → 503', async () => {
    mocks.rpc.mockResolvedValue(reply('qualquer'));
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }))).status).toBe(503);
  });

  it('flag de Integrações desligada → 403 sem chamar o banco', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sem sessão → 401', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }))).status).toBe(401);
  });

  it('Origin divergente → 403 antes de autenticar', async () => {
    expect((await POST(request({ company_id: COMPANY, page_id: PAGE }, 'https://evil.test'))).status).toBe(403);
    expect(mocks.requireAuthenticatedActor).not.toHaveBeenCalled();
  });

  it.each([
    [{ company_id: 'x', page_id: PAGE }],
    [{ company_id: COMPANY, page_id: 'abc' }],
    [{ company_id: COMPANY }],
    [{ company_id: COMPANY, page_id: PAGE, extra: 1 }],
  ])('corpo inválido %j → 400', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
