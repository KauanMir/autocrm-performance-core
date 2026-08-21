// Testes do repositório remoto de Visits (COMMERCIAL-REMOTE-VISITS-B2-A).
// Mock isolado de lib/supabase/client (cadeia from→select→order→order, com
// spies provando ausência de filtros de company/seller/status e de
// qualquer escrita/join). Nenhuma rede real, nenhum apontamento para o
// projeto remoto (ainda em 51 migrations, sem `visits`).
import { describe, expect, it, vi } from 'vitest';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { fetchVisibleVisitRows } from '@/lib/visits/remoteRepository';
import { isRemoteVisitsError } from '@/lib/visits/errors';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function visitRow(overrides: Partial<RemoteVisitRow> = {}): RemoteVisitRow {
  return {
    id: 'visit-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name: null,
    assigned_seller_id: 's1',
    vehicles: ['Golf GTI 2022'],
    scheduled_at: '2026-08-21T17:00:00+00:00',
    status: 'scheduled',
    outcome: null,
    note: '',
    result_note: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    closed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    closed_at: null,
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

function mockVisitsResponse(response: { data: unknown; error: unknown }): Spies {
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2 }));
  const select = vi.fn(() => ({ order: order1 }));
  mocks.from.mockReturnValue({ select, insert, update, delete: del });
  return { select, order1, order2, insert, update, del };
}

describe('fetchVisibleVisitRows — forma exata da consulta', () => {
  it('from/select/order exatos: ordenação por scheduled_at/id, sem filtro de company/seller/status', async () => {
    const spies = mockVisitsResponse({ data: [visitRow()], error: null });
    const rows = await fetchVisibleVisitRows();

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('visits');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.order1).toHaveBeenCalledWith('scheduled_at', { ascending: true });
    expect(spies.order2).toHaveBeenCalledWith('id', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('nenhuma RPC, nenhuma escrita, nenhum join de Lead/Seller', async () => {
    const spies = mockVisitsResponse({ data: [], error: null });
    await fetchVisibleVisitRows();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
    // select('*') nunca com hint de relação embutida (ex.: 'lead:leads(name)').
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.select).not.toHaveBeenCalledWith(expect.stringContaining(':'));
  });

  it('retorno tipado preserva ordem e conteúdo — rows CRUAS, nenhuma adaptação', async () => {
    const a = visitRow({ id: 'visit-a', scheduled_at: '2026-08-21T10:00:00+00:00' });
    const b = visitRow({ id: 'visit-b', scheduled_at: '2026-08-22T10:00:00+00:00' });
    mockVisitsResponse({ data: [a, b], error: null });
    const rows = await fetchVisibleVisitRows();
    expect(rows.map((r) => r.id)).toEqual(['visit-a', 'visit-b']);
    // Nenhum campo de RemoteVisitModel (clientName/assignedSellerId) aparece
    // — só as colunas cruas do banco.
    expect(rows[0]).not.toHaveProperty('clientName');
    expect(rows[0]).not.toHaveProperty('assignedSellerId');
    expect(rows[0].scheduled_at).toBe('2026-08-21T10:00:00+00:00');
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockVisitsResponse({ data: null, error: null });
    await expect(fetchVisibleVisitRows()).resolves.toEqual([]);
  });
});

describe('fetchVisibleVisitRows — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_visits_fetch_failed', async () => {
    mockVisitsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchVisibleVisitRows();
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteVisitsError(e) && e.code === 'remote_visits_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query; raw Postgres nunca é a mensagem do erro', async () => {
    mockVisitsResponse({
      data: null,
      error: { message: 'permission denied', code: '42501', apikey: 'nunca-copiar', details: 'interno' },
    });
    const error = await fetchVisibleVisitRows().catch((e) => e);
    expect(isRemoteVisitsError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('remote_visits_fetch_failed');
  });
});
