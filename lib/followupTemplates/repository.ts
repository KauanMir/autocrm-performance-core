// lib/followupTemplates/repository.ts — leitura de Follow-up Templates
// (FOLLOW-UP-TEMPLATES-A3-EXEC). Manager/Seller: SELECT direto na tabela
// (RLS followup_templates_select é a autoridade — Manager vê ativos+
// inativos, Seller só ativos, precheck A2-EXEC §19). Super Admin contextual:
// RPC list_platform_followup_templates_for_company (única fonte de leitura
// dele — nunca tem membership, a RLS nega por construção). Nenhuma
// company_id é enviada no caminho RLS — só na key de partição do cache; a
// própria RLS decide o isolamento.
import { supabase } from '@/lib/supabase/client';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { adaptFollowUpTemplateRows, type FollowUpTemplateModel, type FollowUpTemplateRow } from '@/lib/followupTemplates/adapter';

// Lead > Follow-up (picker): só templates ativos, ordenados por sort_order.
// Seguro para Manager E Seller (RLS já restringe Seller a ativos; o filtro
// explícito aqui é redundante para Seller e necessário para Manager, cuja
// RLS devolve o superset ativos+inativos).
export async function fetchActiveFollowUpTemplates(): Promise<FollowUpTemplateModel[]> {
  const { data, error } = await supabase
    .from('followup_templates')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'fetch_active_followup_templates');
  return adaptFollowUpTemplateRows((data ?? []) as unknown as FollowUpTemplateRow[]);
}

// Ajustes > Follow-ups (Manager): ativos+inativos, ordenados por sort_order.
// A RLS já garante que só Manager (nunca Seller) recebe as linhas inativas —
// este fetch nunca filtra por is_active de propósito.
export async function fetchManagementFollowUpTemplates(): Promise<FollowUpTemplateModel[]> {
  const { data, error } = await supabase
    .from('followup_templates')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'fetch_management_followup_templates');
  return adaptFollowUpTemplateRows((data ?? []) as unknown as FollowUpTemplateRow[]);
}

// Ajustes > Follow-ups (Super Admin contextual): sempre includeInactive=true
// — a superfície de gerenciamento precisa dos dois, mesma paridade que
// Manager já tem via RLS.
export async function fetchPlatformFollowUpTemplates(companyId: string): Promise<FollowUpTemplateModel[]> {
  const { data, error } = await supabase.rpc('list_platform_followup_templates_for_company', {
    p_company_id: companyId,
    p_include_inactive: true,
  });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'fetch_platform_followup_templates');
  return adaptFollowUpTemplateRows((data ?? []) as unknown as FollowUpTemplateRow[]);
}
