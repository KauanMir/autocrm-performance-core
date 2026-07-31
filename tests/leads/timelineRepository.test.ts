// Testes de lib/leads/timelineRepository.ts (M1-E, E7-B2-A1). Mock isolado
// de lib/supabase/client (cadeia from→select→eq→eq→order→order→order para
// leitura; rpc para a nota manual). Nenhuma rede real, nenhum acesso a
// profiles.
import { describe, expect, it, vi } from 'vitest';
import type { LeadTimelineEntryRow } from '@/lib/supabase/types';
import {
  fetchLeadTimelineEntries,
  addLeadTimelineNote,
  MANUAL_TIMELINE_ICON,
  MANUAL_TIMELINE_COLOR,
  MANUAL_TIMELINE_LABEL,
} from '@/lib/leads/timelineRepository';
import { isRemoteLeadsError } from '@/lib/leads/errors';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function timelineRow(overrides: Partial<LeadTimelineEntryRow> = {}): LeadTimelineEntryRow {
  return {
    id: 'tl-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    actor_profile_id: 'profile-1',
    icon: 'phone',
    color: '#27C75F',
    label: 'Ligação feita',
    detail: 'Cliente confirmou interesse',
    occurred_at: '2026-07-31T10:00:00+00:00',
    created_at: '2026-07-31T10:00:00+00:00',
    ...overrides,
  };
}

type ReadSpies = {
  select: ReturnType<typeof vi.fn>;
  eq1: ReturnType<typeof vi.fn>;
  eq2: ReturnType<typeof vi.fn>;
  order1: ReturnType<typeof vi.fn>;
  order2: ReturnType<typeof vi.fn>;
  order3: ReturnType<typeof vi.fn>;
};

function mockReadResponse(response: { data: unknown; error: unknown }): ReadSpies {
  const order3 = vi.fn().mockReturnValue(Promise.resolve(response));
  const order2 = vi.fn(() => ({ order: order3 }));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq2 = vi.fn(() => ({ order: order1 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  mocks.from.mockReturnValue({ select });
  return { select, eq1, eq2, order1, order2, order3 };
}

describe('fetchLeadTimelineEntries — forma exata da consulta', () => {
  it('from/select/eq/eq/order/order/order exatos: filtra companyId+leadId, ordena mais recente primeiro', async () => {
    const spies = mockReadResponse({ data: [timelineRow()], error: null });
    const rows = await fetchLeadTimelineEntries('company-a', 'lead-1');

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('lead_timeline_entries');
    expect(spies.select).toHaveBeenCalledWith('id, company_id, lead_id, icon, color, label, detail, occurred_at, created_at');
    expect(spies.eq1).toHaveBeenCalledWith('company_id', 'company-a');
    expect(spies.eq2).toHaveBeenCalledWith('lead_id', 'lead-1');
    expect(spies.order1).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(spies.order2).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(spies.order3).toHaveBeenCalledWith('id', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('nunca seleciona a tabela profiles nem faz RPC', async () => {
    mockReadResponse({ data: [], error: null });
    await fetchLeadTimelineEntries('company-a', 'lead-1');
    expect(mocks.from).not.toHaveBeenCalledWith('profiles');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mockReadResponse({ data: null, error: null });
    await expect(fetchLeadTimelineEntries('company-a', 'lead-1')).resolves.toEqual([]);
  });

  it('retorno tipado preserva ordem e conteúdo recebidos', async () => {
    const a = timelineRow({ id: 'tl-a' });
    const b = timelineRow({ id: 'tl-b' });
    mockReadResponse({ data: [b, a], error: null });
    const rows = await fetchLeadTimelineEntries('company-a', 'lead-1');
    expect(rows.map((r) => r.id)).toEqual(['tl-b', 'tl-a']);
  });

  it('companyId vazio lança erro de programação, nunca consulta o Supabase', async () => {
    await expect(fetchLeadTimelineEntries('', 'lead-1')).rejects.toThrow(/companyId/);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('leadId vazio lança erro de programação, nunca consulta o Supabase', async () => {
    await expect(fetchLeadTimelineEntries('company-a', '   ')).rejects.toThrow(/leadId/);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('fetchLeadTimelineEntries — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança remote_leads_fetch_failed', async () => {
    mockReadResponse({ data: null, error: { message: 'permission denied', code: '42501' } });
    const failure = fetchLeadTimelineEntries('company-a', 'lead-1');
    await expect(failure).rejects.toSatisfy(
      (e: unknown) => isRemoteLeadsError(e) && e.code === 'remote_leads_fetch_failed',
    );
  });

  it('detail preserva somente código e mensagem — sem token/credencial/query', async () => {
    mockReadResponse({
      data: null,
      error: { message: 'permission denied', code: '42501', apikey: 'nunca-copiar', hint: 'interno' },
    });
    const error = await fetchLeadTimelineEntries('company-a', 'lead-1').catch((e) => e);
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied', operation: 'lead_timeline_entries.select' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('addLeadTimelineNote — RPC add_lead_timeline_entry', () => {
  it('chama add_lead_timeline_entry com icon/color/label FIXOS, detail com trim, sem p_company_id/actor', async () => {
    mocks.rpc.mockReset().mockResolvedValue({ data: timelineRow({ detail: 'Cliente pediu retorno amanhã' }), error: null });
    const record = await addLeadTimelineNote({ leadId: 'lead-1', detail: '  Cliente pediu retorno amanhã  ' });

    expect(mocks.rpc).toHaveBeenCalledWith('add_lead_timeline_entry', {
      p_lead_id: 'lead-1',
      p_icon: MANUAL_TIMELINE_ICON,
      p_label: MANUAL_TIMELINE_LABEL,
      p_color: MANUAL_TIMELINE_COLOR,
      p_detail: 'Cliente pediu retorno amanhã',
    });
    // Nunca envia p_company_id (Manager/Seller derivam a empresa da própria
    // membership no servidor) nem qualquer campo de actor/e-mail.
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_actor_profile_id');
    expect(args).not.toHaveProperty('actorProfileId');
    expect(args).not.toHaveProperty('email');
    expect(record.detail).toBe('Cliente pediu retorno amanhã');
  });

  it('rejeita texto vazio (ou só espaços) sem chamar a RPC', async () => {
    await expect(addLeadTimelineNote({ leadId: 'lead-1', detail: '   ' })).rejects.toThrow(/detail/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('mapeia erro da RPC para RemoteLeadsMutationError sanitizado (forbidden)', async () => {
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const error = await addLeadTimelineNote({ leadId: 'lead-1', detail: 'texto' }).catch((e) => e);
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.code).toBe('remote_leads_mutation_forbidden');
  });

  it('mapeia erro da RPC para RemoteLeadsMutationError sanitizado (lead_archived)', async () => {
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'lead_archived' } });
    const error = await addLeadTimelineNote({ leadId: 'lead-1', detail: 'texto' }).catch((e) => e);
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.code).toBe('remote_leads_mutation_lead_archived');
  });

  it('resposta vazia (data null) sem erro ainda assim lança generic_error', async () => {
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    const error = await addLeadTimelineNote({ leadId: 'lead-1', detail: 'texto' }).catch((e) => e);
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.code).toBe('remote_leads_mutation_generic_error');
  });
});
