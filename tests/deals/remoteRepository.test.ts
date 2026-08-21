// Testes do repositório remoto de Deals (COMMERCIAL-REMOTE-DEALS-B2-A).
// Mock isolado de lib/supabase/client (cadeia from→select→order→order, com
// spies provando ausência de filtros de company/seller/status e de
// qualquer escrita/join). Nenhuma rede real, nenhum apontamento para o
// projeto remoto (migration #53 ainda não aplicada lá).
import { describe, expect, it, vi } from 'vitest';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { fetchVisibleDealRows } from '@/lib/deals/remoteRepository';
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
