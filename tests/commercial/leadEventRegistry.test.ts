// Testes de lib/commercial/leadEventRegistry.ts (M1-F S8-C2-D2). Confirma
// que o registry corresponde EXATAMENTE aos 18 valores reais de
// lead_event_type (database.types.ts) — nenhum inventado, nenhum ausente,
// nenhum payload exigido além do próprio tipo.
import { describe, expect, it } from 'vitest';
import {
  LEAD_EVENT_REGISTRY,
  LEAD_EVENT_GROUP_ORDER,
  LEAD_EVENT_GROUP_LABELS,
  getLeadEventRegistryEntry,
  groupLeadEventRegistry,
} from '@/lib/commercial/leadEventRegistry';

const REAL_EVENT_TYPES = [
  'call_outcome_visit', 'call_outcome_proposal', 'call_outcome_callback', 'call_outcome_no_answer',
  'visit_scheduled_complete', 'visit_scheduled_incomplete', 'visit_confirmed', 'visit_canceled',
  'visit_rescheduled', 'deal_created_needs_approval', 'deal_created_direct', 'deal_approved',
  'deal_rejected', 'sale_registered', 'sale_canceled', 'visit_result_done', 'visit_result_thinking',
  'visit_result_no_interest',
];

describe('LEAD_EVENT_REGISTRY — corresponde exatamente aos 18 eventos reais', () => {
  it('tem exatamente 18 entradas', () => {
    expect(LEAD_EVENT_REGISTRY).toHaveLength(18);
  });

  it('cobre todos os valores reais de lead_event_type, nenhum a mais, nenhum a menos', () => {
    const registryTypes = LEAD_EVENT_REGISTRY.map((e) => e.eventType).sort();
    expect(registryTypes).toEqual([...REAL_EVENT_TYPES].sort());
  });

  it('nenhuma entrada exige payload além do próprio tipo do evento', () => {
    for (const entry of LEAD_EVENT_REGISTRY) {
      expect(entry.payloadFields).toEqual([]);
    }
  });

  it('todas as entradas estão disponíveis no frontend', () => {
    for (const entry of LEAD_EVENT_REGISTRY) {
      expect(entry.available).toBe(true);
    }
  });

  it('label e description nunca vazios', () => {
    for (const entry of LEAD_EVENT_REGISTRY) {
      expect(entry.label.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
    }
  });

  it('nenhum eventType duplicado', () => {
    const types = LEAD_EVENT_REGISTRY.map((e) => e.eventType);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('agrupamento — dedutível do prefixo real do enum', () => {
  it('call_outcome_* está no grupo "contato"', () => {
    for (const type of ['call_outcome_visit', 'call_outcome_proposal', 'call_outcome_callback', 'call_outcome_no_answer']) {
      expect(getLeadEventRegistryEntry(type as never)?.group).toBe('contato');
    }
  });

  it('visit_* (inclusive visit_result_*) está no grupo "visita"', () => {
    for (const type of [
      'visit_scheduled_complete', 'visit_scheduled_incomplete', 'visit_confirmed', 'visit_canceled',
      'visit_rescheduled', 'visit_result_done', 'visit_result_thinking', 'visit_result_no_interest',
    ]) {
      expect(getLeadEventRegistryEntry(type as never)?.group).toBe('visita');
    }
  });

  it('deal_* está no grupo "proposta"', () => {
    for (const type of ['deal_created_needs_approval', 'deal_created_direct', 'deal_approved', 'deal_rejected']) {
      expect(getLeadEventRegistryEntry(type as never)?.group).toBe('proposta');
    }
  });

  it('sale_* está no grupo "venda"', () => {
    for (const type of ['sale_registered', 'sale_canceled']) {
      expect(getLeadEventRegistryEntry(type as never)?.group).toBe('venda');
    }
  });

  it('LEAD_EVENT_GROUP_ORDER/LABELS cobrem os 4 grupos usados', () => {
    expect(LEAD_EVENT_GROUP_ORDER).toEqual(['contato', 'visita', 'proposta', 'venda']);
    for (const group of LEAD_EVENT_GROUP_ORDER) {
      expect(LEAD_EVENT_GROUP_LABELS[group]).toBeTruthy();
    }
  });

  it('groupLeadEventRegistry() distribui todas as 18 entradas nos 4 grupos, sem perda', () => {
    const grouped = groupLeadEventRegistry();
    let total = 0;
    for (const group of LEAD_EVENT_GROUP_ORDER) {
      total += (grouped.get(group) ?? []).length;
    }
    expect(total).toBe(18);
  });
});

describe('getLeadEventRegistryEntry', () => {
  it('retorna null para um eventType inexistente', () => {
    expect(getLeadEventRegistryEntry('evento_inventado' as never)).toBeNull();
  });
});
