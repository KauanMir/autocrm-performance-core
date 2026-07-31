// lib/leads/timelineRepository.ts — leitura e nota manual da timeline
// remota de Leads para Manager/Seller (M1-E, E7-B2-A1).
//
// Leitura: SELECT direto em lead_timeline_entries (mesmo padrão de
// fetchActiveLeadRows/fetchArchivedLeadRows, lib/leads/remoteRepository.ts)
// — RLS (lead_timeline_select) já é a autoridade real de isolamento;
// company_id/lead_id abaixo são filtro explícito ADICIONAL (defesa em
// profundidade), nunca a prova de autorização. Nenhuma RPC nova de
// listagem: a auditoria E7-B2-A0 confirmou que Manager/Seller nunca
// tiveram (nem precisam) de uma RPC de leitura — só o Super Admin usa
// list_platform_lead_timeline, intocada por este arquivo.
//
// Escrita: reaproveita a RPC já publicada add_lead_timeline_entry (mesma
// usada pela superfície Platform, lib/commercial/repository.ts) — nunca
// p_company_id explícito aqui, mesma convenção de
// lib/leads/remoteMutationRepository.ts: Manager/Seller sempre derivam a
// empresa da própria membership ativa no servidor via
// resolve_lead_mutation_context; enviar p_company_id fingiria uma
// autoridade que o cliente não tem nesse caminho.
import { supabase } from '@/lib/supabase/client';
import type { LeadTimelineEntryRow } from '@/lib/supabase/types';
import { RemoteLeadsError, mapRemoteLeadsMutationError } from '@/lib/leads/errors';

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`timelineRepository: ${label} é obrigatório e não pode ser vazio`);
  }
  return value;
}

// Ordenação (decisão humana da etapa): mais recente primeiro. occurred_at
// desc é a ordem real do evento; created_at desc desempata (duas entradas
// no mesmo occurred_at, ex.: mesma transação); id garante estabilidade
// determinística final. Sem paginação nesta fase — lista completa permitida
// pela RLS.
export async function fetchLeadTimelineEntries(
  companyId: string,
  leadId: string,
): Promise<LeadTimelineEntryRow[]> {
  requireNonEmpty(companyId, 'companyId');
  requireNonEmpty(leadId, 'leadId');

  const { data, error } = await supabase
    .from('lead_timeline_entries')
    .select('id, company_id, lead_id, icon, color, label, detail, occurred_at, created_at')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia — mesmo padrão de fetchActiveLeadRows.
    // Detail preserva somente código/mensagem do PostgREST.
    throw new RemoteLeadsError('remote_leads_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
      operation: 'lead_timeline_entries.select',
    });
  }

  return (data ?? []) as unknown as LeadTimelineEntryRow[];
}

// Valores fixos e sanitizados da nota manual (decisão humana da etapa) —
// nunca escolhidos pelo usuário. Constantes PRÓPRIAS deste módulo (não
// reaproveita PLATFORM_MANUAL_TIMELINE_ICON/COLOR de lib/commercial —
// módulos deliberadamente independentes, nunca importados um pelo outro).
export const MANUAL_TIMELINE_ICON = 'message';
export const MANUAL_TIMELINE_COLOR = '#3B82F6';
export const MANUAL_TIMELINE_LABEL = 'Observação adicionada';

export type AddLeadTimelineNotePayload = {
  leadId: string;
  detail: string;
};

export async function addLeadTimelineNote(
  payload: AddLeadTimelineNotePayload,
): Promise<LeadTimelineEntryRow> {
  const detail = payload.detail.trim();
  if (detail === '') {
    // Defesa em profundidade — o formulário já desabilita o envio com texto
    // vazio; nunca esperado chegar aqui na prática (mesmo padrão de
    // leadQueryKeys.requireId: erro de programação, não de usuário).
    throw new Error('timelineRepository: detail é obrigatório e não pode ser vazio');
  }

  const { data, error } = await supabase.rpc('add_lead_timeline_entry', {
    p_lead_id: payload.leadId,
    p_icon: MANUAL_TIMELINE_ICON,
    p_label: MANUAL_TIMELINE_LABEL,
    p_color: MANUAL_TIMELINE_COLOR,
    p_detail: detail,
    // p_company_id OMITIDO de propósito (ver cabeçalho do arquivo).
  });
  if (error) throw mapRemoteLeadsMutationError(error, 'add_lead_timeline_entry');
  if (!data) throw mapRemoteLeadsMutationError({ message: 'empty_response' }, 'add_lead_timeline_entry');
  return data;
}
