// lib/commercial/repository.ts — leitura comercial remota do Super Admin
// (M1-F S8-C2-B2). SOMENTE leitura: chama exclusivamente as 4 RPCs estreitas
// publicadas no S8-C2-B1 (list_commercial_companies/
// list_platform_leads_for_company/list_platform_lead_timeline/
// list_pipeline_stages_for_company) — nenhum SELECT direto em leads/
// lead_timeline_entries/pipeline_stages/companies, nenhuma RPC de mutation,
// nenhum acesso a sellers (sem policy nenhuma desde o S8-C1-A, sem RPC de
// leitura própria — decisão humana do S8-C2-B2: nome de vendedor NUNCA é
// inventado, ver getLeadAssignmentState no adapter).
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { PlatformCommercialError } from '@/lib/commercial/errors';

export type CommercialCompanyRow =
  Database['public']['Functions']['list_commercial_companies']['Returns'][number];

export type PlatformLeadRow =
  Database['public']['Functions']['list_platform_leads_for_company']['Returns'][number];

export type PlatformLeadTimelineRow =
  Database['public']['Functions']['list_platform_lead_timeline']['Returns'][number];

export type PlatformPipelineStageRow =
  Database['public']['Functions']['list_pipeline_stages_for_company']['Returns'][number];

function detailFrom(error: { code?: unknown; message?: unknown }): { code?: string; message?: string } {
  return {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
  };
}

// Lista TODAS as empresas comerciais visíveis ao Super Admin (inclui
// 'cancelada' — dataset diferente de fetchAccessibleCompanies/useCompanies,
// que a exclui por design; por isso esta função NUNCA reaproveita aquele
// caminho, mesmo que a RPC subjacente já valide is_platform_super_admin()).
export async function fetchCommercialCompanies(): Promise<CommercialCompanyRow[]> {
  const { data, error } = await supabase.rpc('list_commercial_companies');
  if (error) {
    throw new PlatformCommercialError('platform_commercial_companies_fetch_failed', {
      ...detailFrom(error),
      operation: 'list_commercial_companies',
    });
  }
  return data ?? [];
}

// Empresa SEMPRE explícita — nunca chamada com companyId vazio (o hook que
// envolve esta função faz o gating via `enabled`, mesmo padrão de
// fetchActiveLeadRows/useLeads).
export async function fetchPlatformLeads(
  companyId: string,
  archived: boolean,
): Promise<PlatformLeadRow[]> {
  const { data, error } = await supabase.rpc('list_platform_leads_for_company', {
    p_company_id: companyId,
    p_archived: archived,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_leads_fetch_failed', {
      ...detailFrom(error),
      operation: 'list_platform_leads_for_company',
    });
  }
  return data ?? [];
}

export async function fetchPlatformLeadTimeline(
  companyId: string,
  leadId: string,
): Promise<PlatformLeadTimelineRow[]> {
  const { data, error } = await supabase.rpc('list_platform_lead_timeline', {
    p_company_id: companyId,
    p_lead_id: leadId,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_timeline_fetch_failed', {
      ...detailFrom(error),
      operation: 'list_platform_lead_timeline',
    });
  }
  return data ?? [];
}

export async function fetchPlatformPipelineStages(
  companyId: string,
): Promise<PlatformPipelineStageRow[]> {
  const { data, error } = await supabase.rpc('list_pipeline_stages_for_company', {
    p_company_id: companyId,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_stages_fetch_failed', {
      ...detailFrom(error),
      operation: 'list_pipeline_stages_for_company',
    });
  }
  return data ?? [];
}
