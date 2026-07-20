// Testes do repositório remoto de leads (M1-E, E3).
// Mock isolado de lib/supabase/client (cadeia from→select→is→order→order,
// com spies provando ausência de filtros de company e de qualquer escrita).
// Nenhuma rede real.
import { describe, expect, it, vi } from 'vitest';
import type { LeadRow } from '@/lib/supabase/types';
import { fetchActiveLeadRows } from '@/lib/leads/remoteRepository';
import { isRemoteLeadsError } from '@/lib/leads/errors';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    company_id: 'company-1',
    name: 'Carlos Andrade',
    phone: '(11) 99421-1190',
    phone_digits: '11994211190',
    car: 'Golf GTI 2022',
    stage_id: 'stage-negotiation',
    seller_id: 's1',
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato há 3 dias',
    alert_label: 'Responder agora',
    payment_preference: 'Financiamento',
    value_amount: null,
    source: null,
    created_by_profile_id: 'profile-1',
    updated_by_profile_id: null,
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T12:00:00+00:00',
    ...overrides,
  };
}

type Spies = {
  select: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order1: ReturnType<typeof vi.fn>;
  order2: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function mockLeadsResponse(response: { data: unknown; error: unknown }): Spies {
  const eq = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const order2 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order1 = vi.fn(() => ({ order: order2, eq }));
  const is = vi.fn(() => ({ order: order1, eq }));
  const select = vi.fn(() => ({ is, eq }));
  mocks.from.mockReturnValue({ select, insert, update, delete: del, eq });
  return { select, is, order1, order2, eq, insert, update, del };
}

describe('fetchActiveLeadRows — forma exata da consulta', () => {
  it('from/select/is/order exatos: ativos, ordenação estável, sem filtro de company', async () => {
    const spies = mockLeadsResponse({ data: [leadRow()], error: null });
    const rows = await fetchActiveLeadRows();

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('leads');
    expect(spies.select).toHaveBeenCalledWith('*');
    expect(spies.is).toHaveBeenCalledWith('archived_at', null);
    expect(spies.order1).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.order2).toHaveBeenCalledWith('id', { ascending: true });
    // RLS é a autoridade: nenhum .eq (company_id, seller_id, role…).
    expect(spies.eq).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('nenhuma RPC e nenhuma operação de escrita', async () => {
    const spies = mockLeadsResponse({ data: [], error: null });
    await fetchActiveLeadRows();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();
  });

  it('retorno tipado preserva a ordem e o conteúdo recebidos', async () => {
    const a = leadRow({ id: 'lead-a' });
    const b = leadRow({ id: 'lead-b' });
    mockLeadsResponse({ data: [b, a], error: null });
    const rows = await fetchActiveLeadRows();
    expect(rows.map((r) => r.id)).toEqual(['lead-b', 'lead-a']);
    expect(rows[0].version).toBe(1);
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockLeadsResponse({ data: null, error: null });
    await expect(fetchActiveLeadRows()).resolves.toEqual([]);
  });
});

describe('fetchActiveLeadRows — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_leads_fetch_failed', async () => {
    mockLeadsResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchActiveLeadRows();
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteLeadsError(e) && e.code === 'remote_leads_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query', async () => {
    mockLeadsResponse({
      data: null,
      error: {
        message: 'permission denied',
        code: '42501',
        apikey: 'nunca-copiar',
        details: 'internos',
        hint: 'interno',
      },
    });
    const error = await fetchActiveLeadRows().catch((e) => e);
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('remote_leads_fetch_failed');
  });
});
