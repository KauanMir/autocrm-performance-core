// Testes de lib/leads/leadEventMapper.ts (M1-E, E5-A1). Função pura — sem
// mocks. Cobre os 18 resultados reais do enum lead_event_type, provados
// byte-a-byte contra supabase/tests/04_m1e_move_event.sql na auditoria
// E5-A0. FlowCriarAcompanhamento não entra aqui: não existe LeadHealthEvent
// para ele (nenhum valor a testar, de propósito).
import { describe, expect, it } from 'vitest';
import type { LeadHealthEvent } from '@/lib/services';
import { mapLeadHealthEventToRemoteEventType } from '@/lib/leads/leadEventMapper';

describe('mapLeadHealthEventToRemoteEventType — ligação (call)', () => {
  it('visita -> call_outcome_visit', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'call', outcome: 'visita' })).toBe('call_outcome_visit');
  });
  it('proposta -> call_outcome_proposal', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'call', outcome: 'proposta' })).toBe('call_outcome_proposal');
  });
  it('retorno -> call_outcome_callback', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'call', outcome: 'retorno' })).toBe('call_outcome_callback');
  });
  it('naoatendeu -> call_outcome_no_answer', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'call', outcome: 'naoatendeu' })).toBe('call_outcome_no_answer');
  });
});

describe('mapLeadHealthEventToRemoteEventType — visita', () => {
  it('visit_scheduled com hasDate e hasTime -> visit_scheduled_complete', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_scheduled', hasDate: true, hasTime: true }))
      .toBe('visit_scheduled_complete');
  });
  it('visit_scheduled incompleto (falta hasDate) -> visit_scheduled_incomplete', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_scheduled', hasDate: false, hasTime: true }))
      .toBe('visit_scheduled_incomplete');
  });
  it('visit_scheduled incompleto (falta hasTime) -> visit_scheduled_incomplete', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_scheduled', hasDate: true, hasTime: false }))
      .toBe('visit_scheduled_incomplete');
  });
  it('visit_confirmed -> visit_confirmed', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_confirmed' })).toBe('visit_confirmed');
  });
  it('visit_canceled -> visit_canceled', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_canceled' })).toBe('visit_canceled');
  });
  it('visit_rescheduled -> visit_rescheduled', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_rescheduled' })).toBe('visit_rescheduled');
  });
  it('visit_result_done -> visit_result_done', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_result_done' })).toBe('visit_result_done');
  });
  it('visit_result_thinking -> visit_result_thinking', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_result_thinking' })).toBe('visit_result_thinking');
  });
  it('visit_result_no_interest -> visit_result_no_interest', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'visit_result_no_interest' })).toBe('visit_result_no_interest');
  });
});

describe('mapLeadHealthEventToRemoteEventType — proposta', () => {
  it('deal_created needsApproval=true -> deal_created_needs_approval', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'deal_created', needsApproval: true }))
      .toBe('deal_created_needs_approval');
  });
  it('deal_created needsApproval=false -> deal_created_direct', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'deal_created', needsApproval: false }))
      .toBe('deal_created_direct');
  });
  it('deal_approved -> deal_approved', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'deal_approved' })).toBe('deal_approved');
  });
  it('deal_rejected -> deal_rejected', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'deal_rejected' })).toBe('deal_rejected');
  });
});

describe('mapLeadHealthEventToRemoteEventType — venda', () => {
  it('sale_registered -> sale_registered', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'sale_registered' })).toBe('sale_registered');
  });
  it('sale_canceled -> sale_canceled', () => {
    expect(mapLeadHealthEventToRemoteEventType({ type: 'sale_canceled' })).toBe('sale_canceled');
  });
});

describe('mapLeadHealthEventToRemoteEventType — exaustividade', () => {
  it('cobre exatamente os 18 valores reais do enum, sem duplicar e sem faltar nenhum', () => {
    const events: LeadHealthEvent[] = [
      { type: 'call', outcome: 'visita' },
      { type: 'call', outcome: 'proposta' },
      { type: 'call', outcome: 'retorno' },
      { type: 'call', outcome: 'naoatendeu' },
      { type: 'visit_scheduled', hasDate: true, hasTime: true },
      { type: 'visit_scheduled', hasDate: false, hasTime: false },
      { type: 'visit_confirmed' },
      { type: 'visit_canceled' },
      { type: 'visit_rescheduled' },
      { type: 'deal_created', needsApproval: true },
      { type: 'deal_created', needsApproval: false },
      { type: 'deal_approved' },
      { type: 'deal_rejected' },
      { type: 'sale_registered' },
      { type: 'sale_canceled' },
      { type: 'visit_result_done' },
      { type: 'visit_result_thinking' },
      { type: 'visit_result_no_interest' },
    ];
    const mapped = events.map(mapLeadHealthEventToRemoteEventType);
    expect(new Set(mapped).size).toBe(18);
    expect(mapped).toEqual([
      'call_outcome_visit', 'call_outcome_proposal', 'call_outcome_callback', 'call_outcome_no_answer',
      'visit_scheduled_complete', 'visit_scheduled_incomplete',
      'visit_confirmed', 'visit_canceled', 'visit_rescheduled',
      'deal_created_needs_approval', 'deal_created_direct', 'deal_approved', 'deal_rejected',
      'sale_registered', 'sale_canceled',
      'visit_result_done', 'visit_result_thinking', 'visit_result_no_interest',
    ]);
  });
});
