// Adapter das RPCs de processamento: parâmetros exatos e erros sanitizados.
// Cliente admin mockado; nenhuma conexão real.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { createProcessingRpc } from '@/lib/server/meta-webhook/processing-rpc';

const EVENT_ID = 'f9e00000-0000-0000-0000-000000000902';
const LEASE = 'f9100000-0000-0000-0000-000000000902';
const INTEGRATION_ID = 'f9a00000-0000-0000-0000-00000000090b';
const COMPANY_ID = 'f9eeeeee-1111-1111-1111-111111111111';

const claimRow = {
  out_event_id: EVENT_ID,
  out_integration_id: INTEGRATION_ID,
  out_company_id: COMPANY_ID,
  out_page_id: '950000000000902',
  out_leadgen_id: '9990001112223392',
  out_attempts: 1,
  out_lease_token: LEASE,
  out_locked_until: '2026-10-05T12:01:30.000Z',
};

const lookupRow = {
  out_integration_id: INTEGRATION_ID,
  out_company_id: COMPANY_ID,
  out_page_id: '950000000000902',
  out_status: 'connected',
  out_access_token_ciphertext: 'v1.FAKE-CT',
  out_token_key_version: 1,
};

beforeEach(() => {
  rpc.mockReset();
});

describe('claimEvent', () => {
  it('chama a RPC com p_event_id, p_limit 1 e p_lease_seconds 90', async () => {
    rpc.mockResolvedValue({ data: [claimRow], error: null });
    await createProcessingRpc().claimEvent(EVENT_ID);
    expect(rpc).toHaveBeenCalledWith('meta_leadgen_event_claim_batch', {
      p_event_id: EVENT_ID,
      p_limit: 1,
      p_lease_seconds: 90,
    });
  });

  it('mapeia a linha de claim para ClaimedEvent', async () => {
    rpc.mockResolvedValue({ data: [claimRow], error: null });
    const r = await createProcessingRpc().claimEvent(EVENT_ID);
    expect(r).toEqual({
      ok: true,
      value: {
        eventId: EVENT_ID,
        integrationId: INTEGRATION_ID,
        companyId: COMPANY_ID,
        pageId: '950000000000902',
        leadgenId: '9990001112223392',
        attempts: 1,
        leaseToken: LEASE,
      },
    });
  });

  it('zero linhas → ok com value null', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await createProcessingRpc().claimEvent(EVENT_ID)).toEqual({ ok: true, value: null });
  });

  it('mais de uma linha → infrastructure_error', async () => {
    rpc.mockResolvedValue({ data: [claimRow, claimRow], error: null });
    expect(await createProcessingRpc().claimEvent(EVENT_ID)).toEqual({ ok: false, code: 'infrastructure_error' });
  });

  it('linha malformada → infrastructure_error', async () => {
    rpc.mockResolvedValue({ data: [{ out_event_id: EVENT_ID }], error: null });
    expect(await createProcessingRpc().claimEvent(EVENT_ID)).toEqual({ ok: false, code: 'infrastructure_error' });
  });

  it('erro PostgREST não vaza mensagem bruta', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PGRST301 secret detail', code: 'XX000' } });
    const r = await createProcessingRpc().claimEvent(EVENT_ID);
    expect(r).toEqual({ ok: false, code: 'infrastructure_error' });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('exceção de transporte vira infrastructure_error', async () => {
    rpc.mockRejectedValue(new Error('network down at 10.0.0.1'));
    const r = await createProcessingRpc().claimEvent(EVENT_ID);
    expect(r).toEqual({ ok: false, code: 'infrastructure_error' });
    expect(JSON.stringify(r)).not.toContain('10.0.0.1');
  });
});

describe('lookupIntegration', () => {
  it('chama a RPC com p_integration_id', async () => {
    rpc.mockResolvedValue({ data: [lookupRow], error: null });
    await createProcessingRpc().lookupIntegration(INTEGRATION_ID);
    expect(rpc).toHaveBeenCalledWith('meta_connection_lookup_for_processing', { p_integration_id: INTEGRATION_ID });
  });

  it('connected devolve ciphertext e key version', async () => {
    rpc.mockResolvedValue({ data: [lookupRow], error: null });
    const r = await createProcessingRpc().lookupIntegration(INTEGRATION_ID);
    expect(r).toEqual({
      ok: true,
      value: {
        integrationId: INTEGRATION_ID,
        companyId: COMPANY_ID,
        pageId: '950000000000902',
        status: 'connected',
        ciphertext: 'v1.FAKE-CT',
        tokenKeyVersion: 1,
      },
    });
  });

  it('disconnected com ciphertext null é aceito', async () => {
    rpc.mockResolvedValue({ data: [{ ...lookupRow, out_status: 'disconnected', out_access_token_ciphertext: null }], error: null });
    const r = await createProcessingRpc().lookupIntegration(INTEGRATION_ID);
    expect(r.ok && r.value?.ciphertext).toBeNull();
  });

  it('zero linhas → ok com value null', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await createProcessingRpc().lookupIntegration(INTEGRATION_ID)).toEqual({ ok: true, value: null });
  });

  it('erro → infrastructure_error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await createProcessingRpc().lookupIntegration(INTEGRATION_ID)).toEqual({
      ok: false,
      code: 'infrastructure_error',
    });
  });
});

describe('completeLead', () => {
  it('chama a RPC com parâmetros exatos', async () => {
    rpc.mockResolvedValue({ data: [{ out_outcome: 'created', out_crm_lead_id: null }], error: null });
    await createProcessingRpc().completeLead({
      eventId: EVENT_ID,
      leaseToken: LEASE,
      name: 'Cliente Fake',
      phone: '61999990002',
      car: 'Não informado',
    });
    expect(rpc).toHaveBeenCalledWith('meta_leadgen_event_complete', {
      p_event_id: EVENT_ID,
      p_lease_token: LEASE,
      p_name: 'Cliente Fake',
      p_phone: '61999990002',
      p_car: 'Não informado',
    });
  });

  it('devolve o outcome', async () => {
    rpc.mockResolvedValue({ data: [{ out_outcome: 'linked_existing', out_crm_lead_id: null }], error: null });
    const r = await createProcessingRpc().completeLead({
      eventId: EVENT_ID,
      leaseToken: LEASE,
      name: 'x',
      phone: '61999990002',
      car: 'y',
    });
    expect(r).toEqual({ ok: true, value: { outcome: 'linked_existing' } });
  });

  it('erro bruto da RPC não vaza', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates secret_constraint' } });
    const r = await createProcessingRpc().completeLead({
      eventId: EVENT_ID,
      leaseToken: LEASE,
      name: 'x',
      phone: '61999990002',
      car: 'y',
    });
    expect(r).toEqual({ ok: false, code: 'infrastructure_error' });
    expect(JSON.stringify(r)).not.toContain('secret_constraint');
  });

  it('resposta sem linha → infrastructure_error', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await createProcessingRpc().completeLead({
      eventId: EVENT_ID,
      leaseToken: LEASE,
      name: 'x',
      phone: '61999990002',
      car: 'y',
    });
    expect(r).toEqual({ ok: false, code: 'infrastructure_error' });
  });
});

describe('failEvent', () => {
  it('chama a RPC com p_event_id, p_lease_token e p_error_code', async () => {
    rpc.mockResolvedValue({ data: [{ out_outcome: 'retry_scheduled' }], error: null });
    await createProcessingRpc().failEvent({ eventId: EVENT_ID, leaseToken: LEASE, errorCode: 'graph_timeout' });
    expect(rpc).toHaveBeenCalledWith('meta_leadgen_event_fail', {
      p_event_id: EVENT_ID,
      p_lease_token: LEASE,
      p_error_code: 'graph_timeout',
    });
  });

  it('devolve o outcome (lease_lost incluído)', async () => {
    rpc.mockResolvedValue({ data: [{ out_outcome: 'lease_lost' }], error: null });
    const r = await createProcessingRpc().failEvent({ eventId: EVENT_ID, leaseToken: LEASE, errorCode: 'graph_error' });
    expect(r).toEqual({ ok: true, value: { outcome: 'lease_lost' } });
  });

  it('erro → infrastructure_error sem mensagem bruta', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'raw pg detail' } });
    const r = await createProcessingRpc().failEvent({ eventId: EVENT_ID, leaseToken: LEASE, errorCode: 'graph_error' });
    expect(r).toEqual({ ok: false, code: 'infrastructure_error' });
    expect(JSON.stringify(r)).not.toContain('raw pg detail');
  });
});
