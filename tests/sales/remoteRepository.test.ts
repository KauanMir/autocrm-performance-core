// Testes do repositório remoto de Sales (COMMERCIAL-REMOTE-SALES-A2).
// Mock isolado de lib/supabase/client (cadeia from→select→order→order para
// leitura; rpc para a mutation), com spies provando ausência de
// company_id/lead_id/assigned_seller_id/sold_by como parâmetro do cliente.
// Mesmo padrão de tests/deals/remoteRepository.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { RemoteSaleRow } from '@/lib/sales/adapter';
import { fetchVisibleSaleRows, registerRemoteSale } from '@/lib/sales/remoteRepository';
import { isRemoteSalesError } from '@/lib/sales/errors';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function saleRow(overrides: Partial<RemoteSaleRow> = {}): RemoteSaleRow {
  return {
    id: 'sale-1',
    company_id: 'company-a',
    deal_id: 'deal-1',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    sold_value_cents: 11500000,
    payment_method: 'a_vista',
    sold_by: 'profile-1',
    sold_at: '2026-08-22T10:00:00+00:00',
    created_at: '2026-08-22T10:00:00+00:00',
    ...overrides,
  };
}

function dealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-1', company_id: 'company-a', lead_id: 'lead-1', client_name_snapshot: 'Carlos Andrade',
    assigned_seller_id: 's1', vehicle: 'Golf GTI 2022', value_cents: 12000000, discount_percent: 0,
    payment_method: 'a_vista', down_payment_cents: null, installments: null, note: '', status: 'sold',
    created_by: 'profile-1', updated_by: 'profile-1', lost_by: null, lost_at: null,
    created_at: '2026-08-21T10:00:00+00:00', updated_at: '2026-08-22T10:00:00+00:00', version: 2,
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

function mockSalesResponse(response: { data: unknown; error: unknown }): Spies {
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select, insert, update, delete: del });
  return { select, order1, order2, insert, update, del };
}

describe('fetchVisibleSaleRows — forma exata da consulta', () => {
  it('from/select/order exatos: ordenação por sold_at DESC/id ASC, sem filtro de company/seller', async () => {
    const spies = mockSalesResponse({ data: [saleRow()], error: null });
    const rows = await fetchVisibleSaleRows();

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('sales');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.order1).toHaveBeenCalledWith('sold_at', { ascending: false });
    expect(spies.order2).toHaveBeenCalledWith('id', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('nenhuma RPC, nenhuma escrita, nenhum join embutido', async () => {
    const spies = mockSalesResponse({ data: [], error: null });
    await fetchVisibleSaleRows();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.select).not.toHaveBeenCalledWith(expect.stringContaining(':'));
  });

  it('retorno tipado preserva ordem e conteúdo — rows CRUAS, nenhuma adaptação', async () => {
    const a = saleRow({ id: 'sale-a', sold_at: '2026-08-22T12:00:00+00:00' });
    const b = saleRow({ id: 'sale-b', sold_at: '2026-08-21T12:00:00+00:00' });
    mockSalesResponse({ data: [a, b], error: null });
    const rows = await fetchVisibleSaleRows();
    expect(rows.map((r) => r.id)).toEqual(['sale-a', 'sale-b']);
    expect(rows[0]).not.toHaveProperty('soldValueCents');
    expect(rows[0].sold_value_cents).toBe(11500000);
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockSalesResponse({ data: null, error: null });
    await expect(fetchVisibleSaleRows()).resolves.toEqual([]);
  });
});

describe('fetchVisibleSaleRows — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_sales_fetch_failed', async () => {
    mockSalesResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchVisibleSaleRows();
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteSalesError(e) && e.code === 'remote_sales_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query', async () => {
    mockSalesResponse({
      data: null,
      error: { message: 'permission denied', code: '42501', apikey: 'nunca-copiar', details: 'interno' },
    });
    const error = await fetchVisibleSaleRows().catch((e) => e);
    expect(isRemoteSalesError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MUTATION (register_sale)
// ═══════════════════════════════════════════════════════════════════════

describe('registerRemoteSale — forma exata da RPC', () => {
  it('nome/args corretos: somente dealId/expectedVersion/soldValueCents/paymentMethod', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await registerRemoteSale({
      dealId: 'deal-1', expectedVersion: 1, soldValueCents: 11500000, paymentMethod: 'a_vista',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('register_sale', {
      p_deal_id: 'deal-1',
      p_expected_version: 1,
      p_sold_value_cents: 11500000,
      p_payment_method: 'a_vista',
    });
  });

  it('nunca envia company_id/lead_id/assigned_seller_id/sold_by (backend deriva tudo da Deal)', async () => {
    mocks.rpc.mockResolvedValue({ data: dealRow(), error: null });
    await registerRemoteSale({ dealId: 'deal-1', expectedVersion: 1, soldValueCents: 100000, paymentMethod: 'a_vista' });
    const args = mocks.rpc.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(['p_deal_id', 'p_expected_version', 'p_sold_value_cents', 'p_payment_method']);
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_lead_id');
    expect(args).not.toHaveProperty('p_assigned_seller_id');
    expect(args).not.toHaveProperty('p_sold_by');
  });

  it('retorna a DEAL atualizada crua (nunca a Sale)', async () => {
    const row = dealRow({ id: 'deal-1', status: 'sold', version: 2 });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await registerRemoteSale({ dealId: 'deal-1', expectedVersion: 1, soldValueCents: 100000, paymentMethod: 'a_vista' });
    expect(result).toEqual(row);
  });

  it('erro do Supabase vira RemoteSalesError mapeado (deal_closed)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'deal_closed' } });
    await expect(
      registerRemoteSale({ dealId: 'deal-1', expectedVersion: 1, soldValueCents: 100000, paymentMethod: 'a_vista' }),
    ).rejects.toMatchObject({ code: 'remote_sales_mutation_deal_closed' });
  });

  it('erro do Supabase vira RemoteSalesError mapeado (stale_write)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(
      registerRemoteSale({ dealId: 'deal-1', expectedVersion: 1, soldValueCents: 100000, paymentMethod: 'a_vista' }),
    ).rejects.toMatchObject({ code: 'remote_sales_mutation_stale_write' });
  });

  it('data null sem error é anômalo: lança erro genérico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      registerRemoteSale({ dealId: 'deal-1', expectedVersion: 1, soldValueCents: 100000, paymentMethod: 'a_vista' }),
    ).rejects.toMatchObject({ code: 'remote_sales_mutation_generic_error' });
  });
});
