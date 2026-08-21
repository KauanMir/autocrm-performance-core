// Testes do repositório remoto de Deals (COMMERCIAL-REMOTE-DEALS-B2-A read
// + B2-B mutations). Mock isolado de lib/supabase/client (cadeia
// from→select→order→order para leitura; rpc para mutations), com spies
// provando ausência de filtros/campos de company/status/actor/version.
// Nenhuma rede real, nenhum apontamento para o projeto remoto (migration
// #53 ainda não aplicada lá).
import { describe, expect, it, vi } from 'vitest';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import {
  fetchVisibleDealRows,
  createRemoteDeal,
  updateRemoteDeal,
  markRemoteDealLost,
} from '@/lib/deals/remoteRepository';
import { isRemoteDealsError } from '@/lib/deals/errors';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function dealRow(overrides: Partial<RemoteDealRow> = {}): RemoteDealRow {
  return {
    id: 'deal-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name_snapshot: 'Carlos Andrade',
    assigned_seller_id: 's1',
    vehicle: 'Golf GTI 2022',
    value_cents: 12000000,
    discount_percent: 3,
    payment_method: 'financiamento_100',
    down_payment_cents: null,
    installments: null,
    note: '',
    status: 'open',
    lost_by: null,
    lost_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    created_at: '2026-08-21T10:00:00+00:00',
    updated_at: '2026-08-21T10:00:00+00:00',
    version: 1,
    ...overrides,
  };
}

type Spies = {
  select: ReturnType<typeof vi.fn>;
  order1: ReturnType<typeof vi.fn>;
  order2: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function mockDealsResponse(response: { data: unknown; error: unknown }): Spies {
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select, insert, update, delete: del });
  return { select, order1, order2, insert, update, del };
}

describe('fetchVisibleDealRows — forma exata da consulta', () => {
  it('from/select/order exatos: ordenação por created_at DESC/id ASC, sem filtro de company/seller/status', async () => {
    const spies = mockDealsResponse({ data: [dealRow()], error: null });
    const rows = await fetchVisibleDealRows();

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('deals');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.order1).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.order2).toHaveBeenCalledWith('id', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('nenhuma RPC, nenhuma escrita, nenhum join de Lead/Seller', async () => {
    const spies = mockDealsResponse({ data: [], error: null });
    await fetchVisibleDealRows();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
    // select('*') nunca com hint de relação embutida (ex.: 'lead:leads(name)').
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.select).not.toHaveBeenCalledWith(expect.stringContaining(':'));
  });

  it('retorno tipado preserva ordem e conteúdo — rows CRUAS, nenhuma adaptação', async () => {
    const a = dealRow({ id: 'deal-a', created_at: '2026-08-21T12:00:00+00:00' });
    const b = dealRow({ id: 'deal-b', created_at: '2026-08-20T12:00:00+00:00' });
    mockDealsResponse({ data: [a, b], error: null });
    const rows = await fetchVisibleDealRows();
    expect(rows.map((r) => r.id)).toEqual(['deal-a', 'deal-b']);
    // Nenhum campo de RemoteDealModel (clientName/valueCents) aparece — só
    // as colunas cruas do banco.
    expect(rows[0]).not.toHaveProperty('clientName');
    expect(rows[0]).not.toHaveProperty('valueCents');
    expect(rows[0].value_cents).toBe(12000000);
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockDealsResponse({ data: null, error: null });
    await expect(fetchVisibleDealRows()).resolves.toEqual([]);
  });
});

describe('fetchVisibleDealRows — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_deals_fetch_failed', async () => {
    mockDealsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchVisibleDealRows();
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteDealsError(e) && e.code === 'remote_deals_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query; raw Postgres nunca é a mensagem do erro', async () => {
    mockDealsResponse({
      data: null,
      error: { message: 'permission denied', code: '42501', apikey: 'nunca-copiar', details: 'interno' },
    });
    const error = await fetchVisibleDealRows().catch((e) => e);
    expect(isRemoteDealsError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('remote_deals_fetch_failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MUTATIONS (COMMERCIAL-REMOTE-DEALS-B2-B)
// ═══════════════════════════════════════════════════════════════════════

describe('createRemoteDeal — forma exata da RPC', () => {
  it('nome/args corretos, camelCase→p_*, defaults null/null/vazio/null', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await createRemoteDeal({
      leadId: 'lead-1',
      vehicle: 'Golf GTI 2022',
      valueCents: 12000000,
      discountPercent: 3,
      paymentMethod: 'financiamento_100',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('create_deal', {
      p_lead_id: 'lead-1',
      p_vehicle: 'Golf GTI 2022',
      p_value_cents: 12000000,
      p_discount_percent: 3,
      p_payment_method: 'financiamento_100',
      p_down_payment_cents: null,
      p_installments: null,
      p_note: '',
      p_assigned_seller_id: null,
    });
  });

  it('campos opcionais fornecidos são repassados sem transformação', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await createRemoteDeal({
      leadId: 'lead-1',
      vehicle: 'Golf GTI 2022',
      valueCents: 12000000,
      discountPercent: 3,
      paymentMethod: 'a_vista',
      downPaymentCents: 200000,
      installments: '48x',
      note: 'nota',
      assignedSellerId: 's1',
    });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_down_payment_cents: 200000,
      p_installments: '48x',
      p_note: 'nota',
      p_assigned_seller_id: 's1',
    });
  });

  it('nunca envia company_id/status/created_by/version', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await createRemoteDeal({
      leadId: 'lead-1', vehicle: 'Golf', valueCents: 100000, discountPercent: 0, paymentMethod: 'a_vista',
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('status');
    expect(args).not.toHaveProperty('p_status');
    expect(args).not.toHaveProperty('p_created_by');
    expect(args).not.toHaveProperty('p_version');
    expect(args).not.toHaveProperty('p_client_name_snapshot');
  });

  it('retorna a row crua', async () => {
    const row = dealRow({ id: 'deal-novo' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await createRemoteDeal({
      leadId: 'lead-1', vehicle: 'Golf', valueCents: 100000, discountPercent: 0, paymentMethod: 'a_vista',
    });
    expect(result).toEqual(row);
  });

  it('erro do Supabase vira RemoteDealsError mapeado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    await expect(
      createRemoteDeal({ leadId: 'lead-1', vehicle: 'Golf', valueCents: 100000, discountPercent: 0, paymentMethod: 'a_vista' }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_lead_archived' });
  });

  it('data null sem error é anômalo: lança erro genérico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      createRemoteDeal({ leadId: 'lead-1', vehicle: 'Golf', valueCents: 100000, discountPercent: 0, paymentMethod: 'a_vista' }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_generic_error' });
  });
});

describe('updateRemoteDeal — forma exata da RPC (full replace)', () => {
  it('nome/args corretos, todos os 9 campos, nenhum omitido', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow({ version: 2 }), error: null });
    await updateRemoteDeal({
      dealId: 'deal-1',
      expectedVersion: 1,
      vehicle: 'Civic 2023',
      valueCents: 13000000,
      discountPercent: 5,
      paymentMethod: 'a_vista',
      downPaymentCents: null,
      installments: null,
      note: 'atualizada',
      assignedSellerId: 's2',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('update_deal', {
      p_id: 'deal-1',
      p_expected_version: 1,
      p_vehicle: 'Civic 2023',
      p_value_cents: 13000000,
      p_discount_percent: 5,
      p_payment_method: 'a_vista',
      p_down_payment_cents: null,
      p_installments: null,
      p_note: 'atualizada',
      p_assigned_seller_id: 's2',
    });
  });

  it('nunca envia lead_id/company_id/status/lost metadata/client_name_snapshot', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await updateRemoteDeal({
      dealId: 'deal-1', expectedVersion: 1, vehicle: 'Golf', valueCents: 100000, discountPercent: 0,
      paymentMethod: 'a_vista', downPaymentCents: null, installments: null, note: '', assignedSellerId: 's1',
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_lead_id');
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_status');
    expect(args).not.toHaveProperty('p_lost_by');
    expect(args).not.toHaveProperty('p_lost_at');
    expect(args).not.toHaveProperty('p_client_name_snapshot');
  });

  it('erro do Supabase vira RemoteDealsError mapeado (stale_write)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(
      updateRemoteDeal({
        dealId: 'deal-1', expectedVersion: 1, vehicle: 'Golf', valueCents: 100000, discountPercent: 0,
        paymentMethod: 'a_vista', downPaymentCents: null, installments: null, note: '', assignedSellerId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_stale_write' });
  });

  it('retorna a row crua', async () => {
    const row = dealRow({ id: 'deal-1', version: 2 });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await updateRemoteDeal({
      dealId: 'deal-1', expectedVersion: 1, vehicle: 'Golf', valueCents: 100000, discountPercent: 0,
      paymentMethod: 'a_vista', downPaymentCents: null, installments: null, note: '', assignedSellerId: 's1',
    });
    expect(result).toEqual(row);
  });
});

describe('markRemoteDealLost — forma exata da RPC', () => {
  it('nome/args corretos: somente id/expected_version', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow({ status: 'lost' }), error: null });
    await markRemoteDealLost({ dealId: 'deal-1', expectedVersion: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('mark_deal_lost', {
      p_id: 'deal-1',
      p_expected_version: 1,
    });
  });

  it('nenhum outro parâmetro é enviado (sem reason/note)', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow({ status: 'lost' }), error: null });
    await markRemoteDealLost({ dealId: 'deal-1', expectedVersion: 1 });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toEqual(['p_id', 'p_expected_version']);
  });

  it('erro do Supabase vira RemoteDealsError mapeado (deal_closed)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'deal_closed' } });
    await expect(
      markRemoteDealLost({ dealId: 'deal-1', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'remote_deals_mutation_deal_closed' });
  });

  it('retorna a row crua', async () => {
    const row = dealRow({ id: 'deal-1', status: 'lost', lost_by: 'profile-1', lost_at: '2026-08-21T12:00:00+00:00' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await markRemoteDealLost({ dealId: 'deal-1', expectedVersion: 1 });
    expect(result).toEqual(row);
  });
});
