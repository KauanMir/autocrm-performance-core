// lib/commercial/leadEventRegistry.ts — registry TIPADO dos eventos
// comerciais reais aceitos por apply_lead_event (M1-F S8-C2-D2). Inventário
// direto dos 18 valores do enum public.lead_event_type (database.types.ts) —
// nenhum evento inventado, nenhum renomeado, nenhum significado alterado.
//
// payloadFields é SEMPRE [] (tipo `readonly []`): a assinatura real de
// apply_lead_event(p_lead_id, p_event_type, p_company_id?) não aceita
// nenhum campo adicional além do próprio tipo do evento — nenhum dos 18
// eventos exige payload, então não há decisão de produto pendente nem
// formulário a inventar para nenhum deles.
//
// group é deduzido honestamente do próprio prefixo do nome do enum (nunca
// uma classificação nova): 'call_outcome_*' -> contato; 'visit_*' -> visita
// (inclui os 3 'visit_result_*', mesmo prefixo); 'deal_*' -> proposta;
// 'sale_*' -> venda.
//
// label/description reaproveitam o VOCABULÁRIO real já publicado no mapeamento
// evento -> health/labels/estágio de apply_lead_event (20260729140000): label
// descreve o evento em si (o que aconteceu, para quem está registrando);
// description reaproveita o texto real de alert_label daquele mapeamento (o
// follow-up que o próprio backend já define) — nenhum dos dois é inventado.
import type { Database } from '@/lib/supabase/database.types';

export type LeadEventType = Database['public']['Enums']['lead_event_type'];

export type LeadEventGroup = 'contato' | 'visita' | 'proposta' | 'venda';

export type LeadEventRegistryEntry = {
  eventType: LeadEventType;
  group: LeadEventGroup;
  label: string;
  description: string;
  // Nenhum evento real exige payload além do próprio tipo — sempre vazio.
  payloadFields: readonly never[];
  available: true;
};

const EMPTY_PAYLOAD_FIELDS: readonly never[] = Object.freeze([] as const);

export const LEAD_EVENT_REGISTRY: readonly LeadEventRegistryEntry[] = Object.freeze([
  {
    eventType: 'call_outcome_visit',
    group: 'contato',
    label: 'Ligação: visita agendada',
    description: 'Agendar visita',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'call_outcome_proposal',
    group: 'contato',
    label: 'Ligação: proposta apresentada',
    description: 'Montar proposta',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'call_outcome_callback',
    group: 'contato',
    label: 'Ligação: retornar contato depois',
    description: 'Fazer follow-up',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'call_outcome_no_answer',
    group: 'contato',
    label: 'Ligação: cliente não atendeu',
    description: 'Tentar contato novamente',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_scheduled_complete',
    group: 'visita',
    label: 'Visita agendada com sucesso',
    description: 'Visita agendada',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_scheduled_incomplete',
    group: 'visita',
    label: 'Agendamento de visita incompleto',
    description: 'Agendar visita',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_confirmed',
    group: 'visita',
    label: 'Visita confirmada pelo cliente',
    description: 'Visita confirmada',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_canceled',
    group: 'visita',
    label: 'Visita cancelada',
    description: 'Visita cancelada: retomar contato',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_rescheduled',
    group: 'visita',
    label: 'Visita remarcada',
    description: 'Visita remarcada: confirmar novo horário',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_result_done',
    group: 'visita',
    label: 'Visita realizada',
    description: 'Próximo passo comercial',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_result_thinking',
    group: 'visita',
    label: 'Cliente ficou de pensar após a visita',
    description: 'Acompanhar cliente',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'visit_result_no_interest',
    group: 'visita',
    label: 'Cliente sem interesse após a visita',
    description: 'Sem interesse no momento',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'deal_created_needs_approval',
    group: 'proposta',
    label: 'Proposta criada (aguardando aprovação)',
    description: 'Acompanhar proposta',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'deal_created_direct',
    group: 'proposta',
    label: 'Proposta enviada diretamente',
    description: 'Proposta enviada',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'deal_approved',
    group: 'proposta',
    label: 'Proposta aprovada',
    description: 'Proposta aprovada: fechar venda',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'deal_rejected',
    group: 'proposta',
    label: 'Proposta recusada',
    description: 'Renegociar proposta',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'sale_registered',
    group: 'venda',
    label: 'Venda registrada',
    description: 'Venda registrada',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
  {
    eventType: 'sale_canceled',
    group: 'venda',
    label: 'Venda cancelada',
    description: 'Venda cancelada',
    payloadFields: EMPTY_PAYLOAD_FIELDS,
    available: true,
  },
]);

export const LEAD_EVENT_GROUP_LABELS: Record<LeadEventGroup, string> = {
  contato: 'Contato',
  visita: 'Visita',
  proposta: 'Proposta',
  venda: 'Venda',
};

export const LEAD_EVENT_GROUP_ORDER: readonly LeadEventGroup[] = Object.freeze([
  'contato', 'visita', 'proposta', 'venda',
]);

export function getLeadEventRegistryEntry(eventType: LeadEventType): LeadEventRegistryEntry | null {
  return LEAD_EVENT_REGISTRY.find((entry) => entry.eventType === eventType) ?? null;
}

export function groupLeadEventRegistry(): ReadonlyMap<LeadEventGroup, readonly LeadEventRegistryEntry[]> {
  const map = new Map<LeadEventGroup, LeadEventRegistryEntry[]>();
  for (const group of LEAD_EVENT_GROUP_ORDER) map.set(group, []);
  for (const entry of LEAD_EVENT_REGISTRY) {
    map.get(entry.group)!.push(entry);
  }
  return map;
}
