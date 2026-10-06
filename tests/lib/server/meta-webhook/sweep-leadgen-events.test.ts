// Sweep: claim em lote uma única vez, processamento com lease já adquirida.
// RPC e Graph fakes; nenhuma rede, nenhum banco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeLeadgenFieldData } from '@/lib/server/meta-webhook/normalize-lead-fields';
import type { MetaLeadProcessorDeps } from '@/lib/server/meta-webhook/process-leadgen-event';
import type {
  ClaimedEvent,
  CompleteLeadInput,
  FailEventInput,
  ProcessingIntegration,
  ProcessingRpc,
  ProcessingRpcResult,
} from '@/lib/server/meta-webhook/processing-rpc';
import {
  SWEEP_LEASE_SECONDS,
  SWEEP_MAX_LIMIT,
  sweepMetaLeadgenEvents,
} from '@/lib/server/meta-webhook/sweep-leadgen-events';

const TOKEN = 'FAKE-PAGE-TOKEN-p25a-not-real';
const COMPANY = 'fa0eeeee-1111-1111-1111-111111111111';
const INTEGRATION = 'fa0a0000-0000-0000-0000-00000000000a';
const PAGE = '950000000000251';

const CONNECTED: ProcessingIntegration = {
  integrationId: INTEGRATION,
  companyId: COMPANY,
  pageId: PAGE,
  status: 'connected',
  ciphertext: 'v1.FAKE',
  tokenKeyVersion: 1,
};

function eventsOf(n: number): ClaimedEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    eventId: `fa0e0000-0000-0000-0000-${String(100 + i).padStart(12, '0')}`,
    integrationId: INTEGRATION,
    companyId: COMPANY,
    pageId: PAGE,
    leadgenId: `96000000000${String(100 + i)}`,
    attempts: 1,
    leaseToken: `fa100000-0000-0000-0000-${String(100 + i).padStart(12, '0')}`,
  }));
}

interface Overrides {
  claimBatch?: ProcessingRpcResult<ClaimedEvent[]>;
  lookupIntegration?: ProcessingRpcResult<ProcessingIntegration | null>;
  completeLead?: ProcessingRpcResult<{ outcome: string }>;
  failEvent?: ProcessingRpcResult<{ outcome: string }>;
}

function makeMocks(o: Overrides = {}) {
  return {
    claimBatch: vi.fn(
      async (_limit: number, _lease: number): Promise<ProcessingRpcResult<ClaimedEvent[]>> =>
        o.claimBatch ?? { ok: true, value: [] },
    ),
    claimEvent: vi.fn(async (_id: string): Promise<ProcessingRpcResult<ClaimedEvent | null>> => ({ ok: true, value: null })),
    lookupIntegration: vi.fn(
      async (_id: string): Promise<ProcessingRpcResult<ProcessingIntegration | null>> =>
        o.lookupIntegration ?? { ok: true, value: CONNECTED },
    ),
    completeLead: vi.fn(
      async (_input: CompleteLeadInput): Promise<ProcessingRpcResult<{ outcome: string }>> =>
        o.completeLead ?? { ok: true, value: { outcome: 'created' } },
    ),
    failEvent: vi.fn(
      async (_input: FailEventInput): Promise<ProcessingRpcResult<{ outcome: string }>> =>
        o.failEvent ?? { ok: true, value: { outcome: 'retry_scheduled' } },
    ),
  };
}

function makeDeps(o: Overrides = {}) {
  const mocks = makeMocks(o);
  const rpc: ProcessingRpc = mocks;
  const deps: MetaLeadProcessorDeps = {
    rpc,
    graphApiVersion: () => 'v26.0',
    decryptToken: () => ({ ok: true, token: TOKEN }),
    fetchLead: vi.fn(async (input: { leadgenId: string }) => ({
      ok: true as const,
      value: {
        id: input.leadgenId,
        fieldData: [
          { name: 'full_name', values: [`Cliente ${input.leadgenId}`] },
          { name: 'phone_number', values: [`61 9${input.leadgenId.slice(-8)}`] },
        ],
      },
    })),
    normalizeLead: normalizeLeadgenFieldData,
  };
  return { deps, rpc: mocks };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('batch', () => {
  it('zero claimable → resumo zerado', async () => {
    const { deps } = makeDeps();
    expect(await sweepMetaLeadgenEvents({ deps })).toEqual({
      attempted: 0,
      created: 0,
      linkedExisting: 0,
      failed: 0,
      leaseLost: 0,
      notClaimed: 0,
      infrastructureErrors: 0,
    });
  });

  it('um evento → processado uma vez', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: true, value: eventsOf(1) } });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(s).toMatchObject({ attempted: 1, created: 1 });
    expect(rpc.completeLead).toHaveBeenCalledTimes(1);
  });

  it('vários eventos → todos processados em sequência', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: true, value: eventsOf(3) } });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(s).toMatchObject({ attempted: 3, created: 3 });
    expect(rpc.completeLead).toHaveBeenCalledTimes(3);
  });

  it('limite padrão 20; máximo 20; valor inválido cai no padrão', async () => {
    expect(SWEEP_MAX_LIMIT).toBe(20);
    const { deps, rpc } = makeDeps();
    await sweepMetaLeadgenEvents({ deps });
    await sweepMetaLeadgenEvents({ deps, limit: 500 });
    await sweepMetaLeadgenEvents({ deps, limit: 0 });
    await sweepMetaLeadgenEvents({ deps, limit: 2.5 });
    await sweepMetaLeadgenEvents({ deps, limit: 5 });
    expect(rpc.claimBatch.mock.calls.map((c) => c[0])).toEqual([20, 20, 1, 20, 5]);
  });

  it('lease do sweep é 300 s; claim em lote uma vez; claimEvent nunca chamado (sem double-claim)', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: true, value: eventsOf(2) } });
    await sweepMetaLeadgenEvents({ deps });
    expect(rpc.claimBatch).toHaveBeenCalledTimes(1);
    expect(rpc.claimBatch).toHaveBeenCalledWith(20, SWEEP_LEASE_SECONDS);
    expect(SWEEP_LEASE_SECONDS).toBe(300);
    expect(rpc.claimEvent).not.toHaveBeenCalled();
  });
});

describe('resultados por evento', () => {
  it('lookup desconectado, linked_existing, lease_lost e infra são somados corretamente', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: true, value: eventsOf(4) } });
    rpc.lookupIntegration.mockResolvedValueOnce({
      ok: true,
      value: { ...CONNECTED, status: 'disconnected', ciphertext: null },
    });
    rpc.completeLead
      .mockResolvedValueOnce({ ok: true, value: { outcome: 'linked_existing' } })
      .mockResolvedValueOnce({ ok: true, value: { outcome: 'lease_lost' } })
      .mockResolvedValueOnce({ ok: false, code: 'infrastructure_error' });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(s).toEqual({
      attempted: 4,
      created: 0,
      linkedExisting: 1,
      failed: 1,
      leaseLost: 1,
      notClaimed: 0,
      infrastructureErrors: 1,
    });
  });
});

describe('isolamento e falhas', () => {
  it('erro de infraestrutura no claim em lote → infrastructureErrors 1, nenhum processamento', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: false, code: 'infrastructure_error' } });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(s).toMatchObject({ attempted: 0, infrastructureErrors: 1 });
    expect(rpc.completeLead).not.toHaveBeenCalled();
  });

  it('processor lança exceção em um evento → conta infra e segue para o próximo', async () => {
    const { deps, rpc } = makeDeps({ claimBatch: { ok: true, value: eventsOf(3) } });
    rpc.completeLead
      .mockRejectedValueOnce(new Error('internal secret detail'))
      .mockResolvedValueOnce({ ok: true, value: { outcome: 'created' } })
      .mockResolvedValueOnce({ ok: true, value: { outcome: 'created' } });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(s).toMatchObject({ attempted: 3, created: 2, infrastructureErrors: 1 });
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('dependências do processor indisponíveis → resumo de infraestrutura, sem exceção', async () => {
    const s = await sweepMetaLeadgenEvents();
    expect(s).toMatchObject({ attempted: 0, infrastructureErrors: 1 });
  });
});

describe('resultado sanitizado', () => {
  it('resumo tem só contadores numéricos, sem IDs, PII ou token', async () => {
    const events = eventsOf(2);
    const { deps } = makeDeps({ claimBatch: { ok: true, value: events } });
    const s = await sweepMetaLeadgenEvents({ deps });
    expect(Object.keys(s).sort()).toEqual(
      ['attempted', 'created', 'failed', 'infrastructureErrors', 'leaseLost', 'linkedExisting', 'notClaimed'].sort(),
    );
    for (const value of Object.values(s)) expect(typeof value).toBe('number');
    const serialized = JSON.stringify(s);
    for (const forbidden of [COMPANY, INTEGRATION, PAGE, TOKEN, 'Cliente', events[0].eventId, events[0].leaseToken]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
