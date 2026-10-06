// Processor de um evento leadgen com RPC, decrypt e Graph fakes. Sem banco,
// sem rede. Token fake.
import { describe, expect, it, vi } from 'vitest';
import { normalizeLeadgenFieldData } from '@/lib/server/meta-webhook/normalize-lead-fields';
import {
  processMetaLeadgenEvent,
  type MetaLeadProcessorDeps,
} from '@/lib/server/meta-webhook/process-leadgen-event';
import type {
  ClaimedEvent,
  CompleteLeadInput,
  FailEventInput,
  ProcessingIntegration,
  ProcessingRpc,
} from '@/lib/server/meta-webhook/processing-rpc';

const TOKEN = 'FAKE-PAGE-TOKEN-p2-3-not-real';
const EVENT: ClaimedEvent = {
  eventId: 'f9e00000-0000-0000-0000-000000000901',
  integrationId: 'f9a00000-0000-0000-0000-00000000090a',
  companyId: 'f9eeeeee-1111-1111-1111-111111111111',
  pageId: '950000000000901',
  leadgenId: '9990001112223390',
  attempts: 1,
  leaseToken: 'f9100000-0000-0000-0000-000000000901',
};
const CONNECTED: ProcessingIntegration = {
  integrationId: EVENT.integrationId,
  companyId: EVENT.companyId,
  pageId: EVENT.pageId,
  status: 'connected',
  ciphertext: 'v1.FAKE-CT',
  tokenKeyVersion: 1,
};
const FIELD_DATA = [
  { name: 'full_name', values: ['Cliente Fake'] },
  { name: 'phone_number', values: ['+55 61 99999-0001'] },
];

type RpcOverrides = Partial<{
  claim: Awaited<ReturnType<ProcessingRpc['claimEvent']>>;
  lookup: Awaited<ReturnType<ProcessingRpc['lookupIntegration']>>;
  complete: Awaited<ReturnType<ProcessingRpc['completeLead']>>;
  fail: Awaited<ReturnType<ProcessingRpc['failEvent']>>;
}>;

function makeRpc(overrides: RpcOverrides = {}) {
  const rpc = {
    claimEvent: vi.fn(async (_eventId: string) => overrides.claim ?? { ok: true as const, value: EVENT }),
    claimBatch: vi.fn(async (_limit: number, _lease: number) => ({ ok: true as const, value: [] as ClaimedEvent[] })),
    lookupIntegration: vi.fn(
      async (_integrationId: string) => overrides.lookup ?? { ok: true as const, value: CONNECTED },
    ),
    completeLead: vi.fn(
      async (_input: CompleteLeadInput) => overrides.complete ?? { ok: true as const, value: { outcome: 'created' } },
    ),
    failEvent: vi.fn(
      async (_input: FailEventInput) => overrides.fail ?? { ok: true as const, value: { outcome: 'retry_scheduled' } },
    ),
  };
  return rpc;
}

function makeDeps(
  rpcOverrides: RpcOverrides = {},
  extra: Partial<Omit<MetaLeadProcessorDeps, 'rpc'>> = {},
) {
  const rpc = makeRpc(rpcOverrides);
  const deps = {
    rpc,
    graphApiVersion: vi.fn(() => 'v26.0'),
    decryptToken: vi.fn(() => ({ ok: true as const, token: TOKEN })),
    fetchLead: vi.fn(async () => ({ ok: true as const, value: { id: EVENT.leadgenId, fieldData: FIELD_DATA } })),
    normalizeLead: vi.fn(normalizeLeadgenFieldData),
    ...extra,
  };
  return { deps: deps as MetaLeadProcessorDeps & typeof deps, rpc };
}

const run = (deps: MetaLeadProcessorDeps) => processMetaLeadgenEvent(EVENT.eventId, deps);

describe('CLAIM', () => {
  it('nenhum evento claimable → not_claimed, sem lookup nem fail', async () => {
    const { deps, rpc } = makeDeps({ claim: { ok: true, value: null } });
    expect(await run(deps)).toEqual({ outcome: 'not_claimed' });
    expect(rpc.lookupIntegration).not.toHaveBeenCalled();
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });

  it('erro de infraestrutura no claim → infrastructure_error, sem fail (não há lease confiável)', async () => {
    const { deps, rpc } = makeDeps({ claim: { ok: false, code: 'infrastructure_error' } });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
    expect(rpc.completeLead).not.toHaveBeenCalled();
  });
});

describe('LOOKUP', () => {
  it('integração ausente → fail integration_not_found', async () => {
    const { deps, rpc } = makeDeps({ lookup: { ok: true, value: null } });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'integration_not_found' });
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
    expect(rpc.failEvent).toHaveBeenCalledWith({
      eventId: EVENT.eventId,
      leaseToken: EVENT.leaseToken,
      errorCode: 'integration_not_found',
    });
  });

  it('disconnected → fail integration_not_found', async () => {
    const { deps } = makeDeps({ lookup: { ok: true, value: { ...CONNECTED, status: 'disconnected', ciphertext: null } } });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'integration_not_found' });
  });

  it('error → fail token_invalid (política operacional)', async () => {
    const { deps, rpc } = makeDeps({ lookup: { ok: true, value: { ...CONNECTED, status: 'error', ciphertext: null } } });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'token_invalid' });
    expect(rpc.failEvent.mock.calls[0][0].errorCode).toBe('token_invalid');
  });

  it.each([
    ['company diferente', { companyId: 'f9eeeeee-2222-2222-2222-222222222222' }],
    ['page diferente', { pageId: '950000000000999' }],
    ['integração diferente', { integrationId: 'f9a00000-0000-0000-0000-0000000009ff' }],
  ])('mismatch de %s → fail integration_not_found, nenhum decrypt', async (_label, override) => {
    const { deps } = makeDeps({ lookup: { ok: true, value: { ...CONNECTED, ...override } } });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'integration_not_found' });
    expect(deps.decryptToken).not.toHaveBeenCalled();
  });

  it('connected sem ciphertext → fail token_decrypt_failed', async () => {
    const { deps } = makeDeps({ lookup: { ok: true, value: { ...CONNECTED, ciphertext: null } } });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'token_decrypt_failed' });
  });

  it('erro de infraestrutura no lookup → infrastructure_error, sem fail', async () => {
    const { deps, rpc } = makeDeps({ lookup: { ok: false, code: 'infrastructure_error' } });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });

  it('status desconhecido → infrastructure_error, sem fail', async () => {
    const { deps, rpc } = makeDeps({ lookup: { ok: true, value: { ...CONNECTED, status: 'weird' } } });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });
});

describe('DECRYPT', () => {
  it('sucesso: decrypt recebe company, page, ciphertext e key version do lookup', async () => {
    const { deps } = makeDeps();
    await run(deps);
    expect(deps.decryptToken).toHaveBeenCalledWith({
      ciphertext: CONNECTED.ciphertext,
      companyId: EVENT.companyId,
      pageId: EVENT.pageId,
      keyVersion: 1,
    });
  });

  it('falha de decrypt → fail token_decrypt_failed; Graph nunca é chamado (F)', async () => {
    const { deps } = makeDeps({}, { decryptToken: vi.fn(() => ({ ok: false as const })) });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'token_decrypt_failed' });
    expect(deps.fetchLead).not.toHaveBeenCalled();
  });
});

describe('GRAPH', () => {
  const graphErrors = [
    'token_invalid',
    'graph_permission_missing',
    'lead_not_found',
    'graph_timeout',
    'graph_error',
    'graph_malformed',
  ] as const;

  it.each(graphErrors)('erro Graph %s → fail com o mesmo código, sem complete (A/H)', async (code) => {
    const { deps, rpc } = makeDeps({}, {
      fetchLead: vi.fn(async () => ({ ok: false as const, code })),
    });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: code });
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
    expect(rpc.completeLead).not.toHaveBeenCalled();
    expect(deps.normalizeLead).not.toHaveBeenCalled();
  });

  it('token_invalid: fail exatamente uma vez e nenhum complete (A)', async () => {
    const { deps, rpc } = makeDeps({}, {
      fetchLead: vi.fn(async () => ({ ok: false as const, code: 'token_invalid' as const })),
    });
    await run(deps);
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
    expect(rpc.completeLead).not.toHaveBeenCalled();
  });

  it('Graph recebe versão, leadgen_id e token em memória', async () => {
    const { deps } = makeDeps();
    await run(deps);
    expect(deps.fetchLead).toHaveBeenCalledWith({
      graphApiVersion: 'v26.0',
      leadgenId: EVENT.leadgenId,
      pageAccessToken: TOKEN,
    });
  });
});

describe('NORMALIZE', () => {
  it.each([
    ['invalid_field_data', [{ name: 'full_name' }]],
    ['missing_name', [{ name: 'phone_number', values: ['61 99999-0002'] }]],
    ['missing_phone', [{ name: 'full_name', values: ['Cliente Fake'] }]],
  ])('%s → fail, sem complete', async (code, fieldData) => {
    const { deps, rpc } = makeDeps({}, {
      fetchLead: vi.fn(async () => ({ ok: true as const, value: { id: EVENT.leadgenId, fieldData } })),
    });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: code });
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
    expect(rpc.completeLead).not.toHaveBeenCalled();
  });

  it('missing_phone: fail exatamente uma vez (B)', async () => {
    const { deps, rpc } = makeDeps({}, {
      fetchLead: vi.fn(async () => ({
        ok: true as const,
        value: { id: EVENT.leadgenId, fieldData: [{ name: 'full_name', values: ['Cliente Fake'] }] },
      })),
    });
    await run(deps);
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
  });

  it('normalize recebe o fieldData do Graph e complete recebe apenas name/phone/car', async () => {
    const { deps, rpc } = makeDeps();
    await run(deps);
    expect(deps.normalizeLead).toHaveBeenCalledWith(FIELD_DATA);
    expect(rpc.completeLead).toHaveBeenCalledWith({
      eventId: EVENT.eventId,
      leaseToken: EVENT.leaseToken,
      name: 'Cliente Fake',
      phone: '61999990001',
      car: 'Não informado',
    });
  });

  it('normalize nunca é chamado se Graph falhar (G)', async () => {
    const { deps } = makeDeps({}, {
      fetchLead: vi.fn(async () => ({ ok: false as const, code: 'graph_timeout' as const })),
    });
    await run(deps);
    expect(deps.normalizeLead).not.toHaveBeenCalled();
  });
});

describe('COMPLETE', () => {
  it('created → outcome created; complete 1 vez; fail 0 vezes (C)', async () => {
    const { deps, rpc } = makeDeps({ complete: { ok: true, value: { outcome: 'created' } } });
    expect(await run(deps)).toEqual({ outcome: 'created' });
    expect(rpc.completeLead).toHaveBeenCalledTimes(1);
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });

  it('linked_existing → complete 1 vez; fail 0 vezes (D)', async () => {
    const { deps, rpc } = makeDeps({ complete: { ok: true, value: { outcome: 'linked_existing' } } });
    expect(await run(deps)).toEqual({ outcome: 'linked_existing' });
    expect(rpc.completeLead).toHaveBeenCalledTimes(1);
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });

  it('lease_lost no complete → lease_lost, sem fail e sem repetir complete (E)', async () => {
    const { deps, rpc } = makeDeps({ complete: { ok: true, value: { outcome: 'lease_lost' } } });
    expect(await run(deps)).toEqual({ outcome: 'lease_lost' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
    expect(rpc.completeLead).toHaveBeenCalledTimes(1);
  });

  it.each(['integration_not_found', 'initial_stage_missing', 'duplicate_phone_ambiguous'] as const)(
    '%s → fail com o mesmo código',
    async (outcome) => {
      const { deps, rpc } = makeDeps({ complete: { ok: true, value: { outcome } } });
      expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: outcome });
      expect(rpc.failEvent).toHaveBeenCalledTimes(1);
      expect(rpc.failEvent.mock.calls[0][0].errorCode).toBe(outcome);
    },
  );

  it('erro de infraestrutura no complete → infrastructure_error, sem fail', async () => {
    const { deps, rpc } = makeDeps({ complete: { ok: false, code: 'infrastructure_error' } });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });

  it('outcome desconhecido → infrastructure_error, sem inventar código', async () => {
    const { deps, rpc } = makeDeps({ complete: { ok: true, value: { outcome: 'surprise' } } });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).not.toHaveBeenCalled();
  });
});

describe('FAIL', () => {
  it('lease_lost no fail → lease_lost, sem segunda tentativa', async () => {
    const { deps, rpc } = makeDeps({
      lookup: { ok: true, value: null },
      fail: { ok: true, value: { outcome: 'lease_lost' } },
    });
    expect(await run(deps)).toEqual({ outcome: 'lease_lost' });
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
  });

  it('erro de infraestrutura no fail → infrastructure_error, sem nova tentativa', async () => {
    const { deps, rpc } = makeDeps({
      lookup: { ok: true, value: null },
      fail: { ok: false, code: 'infrastructure_error' },
    });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
    expect(rpc.failEvent).toHaveBeenCalledTimes(1);
  });

  it('failed_max_attempts → errorCode max_attempts', async () => {
    const { deps } = makeDeps({
      lookup: { ok: true, value: null },
      fail: { ok: true, value: { outcome: 'failed_max_attempts' } },
    });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'max_attempts' });
  });

  it('failed_terminal → failed com o código', async () => {
    const { deps } = makeDeps({
      lookup: { ok: true, value: null },
      fail: { ok: true, value: { outcome: 'failed_terminal' } },
    });
    expect(await run(deps)).toEqual({ outcome: 'failed', errorCode: 'integration_not_found' });
  });

  it('outcome desconhecido no fail → infrastructure_error', async () => {
    const { deps } = makeDeps({
      lookup: { ok: true, value: null },
      fail: { ok: true, value: { outcome: 'surprise' } },
    });
    expect(await run(deps)).toEqual({ outcome: 'infrastructure_error' });
  });
});

describe('segurança do resultado', () => {
  it('token plaintext nunca aparece no resultado nem nos argumentos de fail (I)', async () => {
    const { deps, rpc } = makeDeps({
      complete: { ok: true, value: { outcome: 'created' } },
    });
    const result = await run(deps);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    for (const call of rpc.failEvent.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    for (const call of rpc.completeLead.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
  });

  it('resultado de falha carrega só outcome e errorCode, sem IDs ou PII', async () => {
    const { deps } = makeDeps({ lookup: { ok: true, value: null } });
    const result = await run(deps);
    expect(Object.keys(result).sort()).toEqual(['errorCode', 'outcome']);
    const serialized = JSON.stringify(result);
    for (const forbidden of [EVENT.eventId, EVENT.leadgenId, EVENT.pageId, EVENT.companyId, 'Cliente Fake']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('nenhum fake de Graph ou de decrypt é chamado quando o claim não traz evento', async () => {
    const { deps } = makeDeps({ claim: { ok: true, value: null } });
    await run(deps);
    expect(deps.decryptToken).not.toHaveBeenCalled();
    expect(deps.fetchLead).not.toHaveBeenCalled();
  });
});
