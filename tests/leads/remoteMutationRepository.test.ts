// Testes de lib/leads/remoteMutationRepository.ts (M1-E, E4-B1 + E5-A1
// move/event). Supabase mockado (rpc), sem rede real. Prova: create/update/
// duplicate/move/event chamam a RPC certa, NUNCA enviam p_company_id (e
// move NUNCA envia p_expected_version), erro vira RemoteLeadsError via
// mapRemoteLeadsMutationError, retorno tipado preservado.
import { describe, expect, it, vi } from 'vitest';
import {
  createRemoteLead,
  updateRemoteLead,
  checkRemoteLeadPhoneDuplicate,
  normalizeLeadPhoneDigits,
  moveRemoteLeadToStage,
  applyRemoteLeadEvent,
} from '@/lib/leads/remoteMutationRepository';
import { isRemoteLeadsError } from '@/lib/leads/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const CREATED = { id: 'lead-1', company_id: 'company-a', name: 'Cliente', version: 1 };

describe('createRemoteLead', () => {
  it('chama create_lead SEM p_company_id, com os campos corretos', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
    await createRemoteLead({
      name: 'Cliente',
      phone: '11999990000',
      car: 'Golf',
      sellerId: 's1',
      temperature: 'hot',
      paymentPreference: 'À vista',
      source: 'WhatsApp',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('create_lead', {
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_seller_id: 's1',
      p_temperature: 'hot',
      p_payment_preference: 'À vista',
      p_source: 'WhatsApp',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
  });

  it('sellerId ausente/null: p_seller_id undefined (Seller sempre autoatribuído pelo backend)', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
    await createRemoteLead({ name: 'Cliente', phone: '119999', car: 'Golf', sellerId: null });
    expect(mocks.rpc.mock.calls[0][1].p_seller_id).toBeUndefined();
  });

  it('retorna a linha real quando não há erro', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
    const result = await createRemoteLead({ name: 'Cliente', phone: '119999', car: 'Golf' });
    expect(result).toEqual(CREATED);
  });

  it('erro do Supabase vira RemoteLeadsError mapeado (mensagem estável preservada em detail)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    const failure = createRemoteLead({ name: 'X', phone: '1', car: 'Y' });
    await expect(failure).rejects.toSatisfy((e: unknown) => isRemoteLeadsError(e));
    await expect(failure).rejects.toMatchObject({ code: 'remote_leads_mutation_seller_not_found' });
  });

  it('data null (sem erro) é anômalo: lança generic_error, nunca retorna undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createRemoteLead({ name: 'X', phone: '1', car: 'Y' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_generic_error' });
  });
});

describe('updateRemoteLead', () => {
  it('chama update_lead SEM p_company_id, apenas com os campos reais', async () => {
    mocks.rpc.mockResolvedValue({ data: CREATED, error: null });
    await updateRemoteLead({
      leadId: 'lead-1',
      expectedVersion: 3,
      name: 'Cliente',
      phone: '11999990000',
      car: 'Golf',
      temperature: 'warm',
      paymentPreference: 'Financiamento',
      source: 'Indicação',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('update_lead', {
      p_lead_id: 'lead-1',
      p_expected_version: 3,
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_temperature: 'warm',
      p_payment_preference: 'Financiamento',
      p_source: 'Indicação',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_seller_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_stage_id');
  });

  it('stale_write do Supabase vira RemoteLeadsError com código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(
      updateRemoteLead({ leadId: 'lead-1', expectedVersion: 1, name: 'X', phone: '1', car: 'Y' }),
    ).rejects.toMatchObject({ code: 'remote_leads_mutation_stale_write' });
  });
});

describe('checkRemoteLeadPhoneDuplicate', () => {
  it('chama check_lead_phone_duplicate SEM p_company_id', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await checkRemoteLeadPhoneDuplicate({ phone: '11999990000' });
    expect(mocks.rpc).toHaveBeenCalledWith('check_lead_phone_duplicate', {
      p_phone: '11999990000',
      p_exclude_lead_id: undefined,
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
  });

  it('excludeLeadId é repassado como p_exclude_lead_id', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await checkRemoteLeadPhoneDuplicate({ phone: '11999990000', excludeLeadId: 'lead-1' });
    expect(mocks.rpc.mock.calls[0][1].p_exclude_lead_id).toBe('lead-1');
  });

  it('retorno vazio (data null) é lista vazia válida, nunca erro', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(checkRemoteLeadPhoneDuplicate({ phone: '119999' })).resolves.toEqual([]);
  });

  it('preserva status/lead_id/lead_name/lead_archived exatamente como recebidos', async () => {
    const rows = [{ status: 'accessible', lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    await expect(checkRemoteLeadPhoneDuplicate({ phone: '119999' })).resolves.toEqual(rows);
  });

  it('invalid_phone do Supabase vira RemoteLeadsError mapeado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_phone' } });
    await expect(checkRemoteLeadPhoneDuplicate({ phone: 'abc' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_invalid_phone' });
  });
});

describe('moveRemoteLeadToStage', () => {
  const MOVED = { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-2', version: 2 };

  it('chama move_lead_to_stage SEM p_company_id e SEM p_expected_version (LWW)', async () => {
    mocks.rpc.mockResolvedValue({ data: MOVED, error: null });
    await moveRemoteLeadToStage({ leadId: 'lead-1', stageId: 'stage-2' });
    expect(mocks.rpc).toHaveBeenCalledWith('move_lead_to_stage', {
      p_lead_id: 'lead-1',
      p_stage_id: 'stage-2',
    });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty('p_company_id');
    expect(args).not.toHaveProperty('p_expected_version');
  });

  it('retorna a linha real quando não há erro', async () => {
    mocks.rpc.mockResolvedValue({ data: MOVED, error: null });
    await expect(moveRemoteLeadToStage({ leadId: 'lead-1', stageId: 'stage-2' })).resolves.toEqual(MOVED);
  });

  it('stage_not_found do Supabase vira RemoteLeadsError com código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    await expect(moveRemoteLeadToStage({ leadId: 'lead-1', stageId: 'stage-x' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_stage_not_found' });
  });

  it('forbidden do Supabase vira RemoteLeadsError com código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } });
    await expect(moveRemoteLeadToStage({ leadId: 'lead-1', stageId: 'stage-2' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_forbidden' });
  });

  it('data null (sem erro) é anômalo: lança generic_error, nunca retorna undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(moveRemoteLeadToStage({ leadId: 'lead-1', stageId: 'stage-2' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_generic_error' });
  });
});

describe('applyRemoteLeadEvent', () => {
  const EVENTED = { id: 'lead-1', company_id: 'company-a', stage_id: 'stage-1', urgency: 'amber', version: 2 };

  it('chama apply_lead_event SEM p_company_id, com o evento tipado', async () => {
    mocks.rpc.mockResolvedValue({ data: EVENTED, error: null });
    await applyRemoteLeadEvent({ leadId: 'lead-1', eventType: 'visit_confirmed' });
    expect(mocks.rpc).toHaveBeenCalledWith('apply_lead_event', {
      p_lead_id: 'lead-1',
      p_event_type: 'visit_confirmed',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
  });

  it('retorna a linha real quando não há erro', async () => {
    mocks.rpc.mockResolvedValue({ data: EVENTED, error: null });
    await expect(applyRemoteLeadEvent({ leadId: 'lead-1', eventType: 'sale_registered' })).resolves.toEqual(EVENTED);
  });

  it('lead_archived do Supabase vira RemoteLeadsError com código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_archived' } });
    await expect(applyRemoteLeadEvent({ leadId: 'lead-1', eventType: 'visit_confirmed' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_lead_archived' });
  });

  it('stage_not_found do Supabase (evento exige stage_code inexistente na empresa) vira código namespaced', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stage_not_found' } });
    await expect(applyRemoteLeadEvent({ leadId: 'lead-1', eventType: 'call_outcome_visit' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_stage_not_found' });
  });

  it('data null (sem erro) é anômalo: lança generic_error, nunca retorna undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(applyRemoteLeadEvent({ leadId: 'lead-1', eventType: 'visit_confirmed' }))
      .rejects.toMatchObject({ code: 'remote_leads_mutation_generic_error' });
  });
});

describe('normalizeLeadPhoneDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(normalizeLeadPhoneDigits('(11) 90000-0001')).toBe('11900000001');
  });

  it('string sem nenhum dígito vira string vazia', () => {
    expect(normalizeLeadPhoneDigits('abc')).toBe('');
  });
});
