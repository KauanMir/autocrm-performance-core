// Route do webhook com a flag de ingestão ligada/desligada. Ingestão mockada:
// aqui se testa só a decisão HTTP e o que vai para o log.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ingestLeadgenChange = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/meta-webhook/ingestion', () => ({ ingestLeadgenChange }));

import { POST } from '@/app/api/webhooks/meta/route';

const APP_SECRET = 'fake-app-secret-for-tests-only';
const ENDPOINT = 'https://crm.example.test/api/webhooks/meta';

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

const body = (changes: number) =>
  JSON.stringify({
    object: 'page',
    entry: [
      {
        id: '1112223334445556',
        time: 1,
        changes: Array.from({ length: changes }, (_, i) => ({
          field: 'leadgen',
          value: {
            page_id: '1112223334445556',
            form_id: '7778889990001112',
            leadgen_id: `999000111222333${i}`,
            created_time: 1,
          },
        })),
      },
    ],
  });

beforeEach(() => {
  vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', 'fake-verify-token-for-tests-only');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  ingestLeadgenChange.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/meta com ingestão', () => {
  it('flag ausente ou diferente de "true" → nenhuma ingestão, 200', async () => {
    for (const value of ['', 'false', 'TRUE', '1', 'yes']) {
      vi.stubEnv('META_LEAD_INGESTION_ENABLED', value);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = await POST(post(body(1)));
      expect(res.status).toBe(200);
    }
    expect(ingestLeadgenChange).not.toHaveBeenCalled();
  });

  it('flag "true" → ingestão por change, 200', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
    ingestLeadgenChange.mockResolvedValue('registered');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(post(body(2)));
    expect(res.status).toBe(200);
    expect(ingestLeadgenChange).toHaveBeenCalledTimes(2);
  });

  it('infra_failure → 503 com corpo genérico', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
    ingestLeadgenChange.mockResolvedValue('infra_failure');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(post(body(1)));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('service unavailable');
  });

  it('casos não processáveis (other_company, no_connection, already_exists) → 200', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
    ingestLeadgenChange
      .mockResolvedValueOnce('skipped_other_company')
      .mockResolvedValueOnce('skipped_no_connection')
      .mockResolvedValueOnce('already_exists');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(post(body(3)));
    expect(res.status).toBe(200);
  });

  it('log com flag ON nunca contém IDs, mesmo com ingestão registrando', async () => {
    vi.stubEnv('META_LEAD_INGESTION_ENABLED', 'true');
    ingestLeadgenChange.mockResolvedValue('registered');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await POST(post(body(1)));
    const logged = logSpy.mock.calls.map((a) => a.join(' ')).join('\n');
    expect(logged).toContain('leadgen_registered');
    expect(logged).toContain('"testCompany":true');
    expect(logged).not.toContain('7778889990001112');
    expect(logged).not.toContain('9990001112223330');
    expect(logged).not.toContain('1112223334445556');
  });
});
