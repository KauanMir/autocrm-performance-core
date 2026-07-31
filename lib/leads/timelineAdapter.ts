// lib/leads/timelineAdapter.ts — adapter puro de entradas de timeline remota
// de Leads (M1-E, E7-B2-A1). Converte LeadTimelineEntryRow (snake_case,
// Supabase) no modelo de apresentação — puro: sem React, sem rede, sem
// StoreAdapter.
//
// Deliberadamente SEM company_id/actor_profile_id no tipo de apresentação:
// decisão humana da etapa — a tabela não guarda snapshot textual do nome do
// ator (lead_timeline_actor_fk aponta para company_memberships, sem coluna
// de nome), o nome atual do profile poderia divergir do nome no momento do
// evento, e a superfície Platform já publicada (usePlatformLeadTimeline)
// também não exibe ator — resolver o histórico nominal fica para uma
// decisão futura. companyId nunca precisa aparecer na UI (só particiona
// cache, na query key).
import type { LeadTimelineEntryRow } from '@/lib/supabase/types';

export interface LeadTimelineEntry {
  id: string;
  leadId: string;
  icon: string;
  color: string;
  label: string;
  detail: string | null;
  occurredAt: string;
  createdAt: string;
}

// Fallback visual seguro — nunca deveria disparar (icon/color têm CHECK
// btrim <> '' no banco, m1e_02), mas garante que um dado inesperado nunca
// vire uma string vazia/código interno na UI (o próprio componente Icon já
// tem fallback para nome desconhecido; isto cobre o caso de valor em branco).
const FALLBACK_ICON = 'history';
const FALLBACK_COLOR = '#8B8B93';

function safeIcon(icon: string): string {
  return typeof icon === 'string' && icon.trim() !== '' ? icon : FALLBACK_ICON;
}

function safeColor(color: string): string {
  return typeof color === 'string' && color.trim() !== '' ? color : FALLBACK_COLOR;
}

export function adaptLeadTimelineEntry(row: LeadTimelineEntryRow): LeadTimelineEntry {
  return {
    id: row.id,
    leadId: row.lead_id,
    icon: safeIcon(row.icon),
    color: safeColor(row.color),
    label: row.label,
    detail: row.detail,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function adaptLeadTimelineEntries(rows: readonly LeadTimelineEntryRow[]): LeadTimelineEntry[] {
  return rows.map(adaptLeadTimelineEntry);
}
