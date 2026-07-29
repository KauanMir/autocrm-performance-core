// lib/commercial/repository.ts — leitura E mutation comercial remota do
// Super Admin (M1-F S8-C2-B2 leitura; M1-F S8-C2-C2 mutation/Sellers/
// duplicidade). Chama exclusivamente as RPCs estreitas publicadas
// (list_commercial_companies/list_platform_leads_for_company/
// list_platform_lead_timeline/list_pipeline_stages_for_company/
// list_platform_sellers_for_company/create_lead/update_lead/
// check_lead_phone_duplicate) — nenhum SELECT direto em leads/
// lead_timeline_entries/pipeline_stages/companies/sellers.
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

// M1-F S8-C2-C2 — Seller picker (list_platform_sellers_for_company). seller_id
// é identidade POR EMPRESA (achado da S8-C2-C2-SELLERS-B1: transfer_membership
// cria uma linha sellers NOVA na empresa destino) — nunca reaproveitado entre
// empresas por nenhum chamador desta função.
export type PlatformSellerRow =
  Database['public']['Functions']['list_platform_sellers_for_company']['Returns'][number];

// create_lead/update_lead retornam a linha REAL de leads (isOneToOne=true,
// isSetofReturn=false) — objeto único, nunca array.
export type PlatformLeadRecord = Database['public']['Functions']['create_lead']['Returns'];

export type PlatformLeadDuplicateRow =
  Database['public']['Functions']['check_lead_phone_duplicate']['Returns'][number];

export type CreatePlatformLeadInput = {
  companyId: string;
  name: string;
  phone: string;
  car: string;
  paymentPreference?: string;
  sellerId?: string;
  source?: string;
  temperature?: Database['public']['Enums']['lead_temperature'];
};

export type UpdatePlatformLeadInput = {
  companyId: string;
  leadId: string;
  expectedVersion: number;
  name: string;
  phone: string;
  car: string;
  paymentPreference?: string;
  source?: string;
  temperature?: Database['public']['Enums']['lead_temperature'];
};

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

// Empresa SEMPRE explícita — mesmo padrão de fetchPlatformLeads/
// fetchPlatformPipelineStages. Nunca consultada sem companyId (o hook faz o
// gating via `enabled`).
export async function fetchPlatformSellers(companyId: string): Promise<PlatformSellerRow[]> {
  const { data, error } = await supabase.rpc('list_platform_sellers_for_company', {
    p_company_id: companyId,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_sellers_fetch_failed', {
      ...detailFrom(error),
      operation: 'list_platform_sellers_for_company',
    });
  }
  return data ?? [];
}

// companyId SEMPRE o valor capturado pelo chamador no momento de abertura do
// formulário (nunca um fallback implícito para a empresa atualmente
// selecionada) — proteção contra a mutation aterrissar no contexto errado se
// a empresa for trocada em voo (decisão S8-C2-C2 §11).
export async function createPlatformLead(input: CreatePlatformLeadInput): Promise<PlatformLeadRecord> {
  const { data, error } = await supabase.rpc('create_lead', {
    p_company_id: input.companyId,
    p_name: input.name,
    p_phone: input.phone,
    p_car: input.car,
    p_payment_preference: input.paymentPreference || undefined,
    p_seller_id: input.sellerId || undefined,
    p_source: input.source || undefined,
    p_temperature: input.temperature,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_lead_create_failed', {
      ...detailFrom(error),
      operation: 'create_lead',
    });
  }
  // create_lead sempre retorna a linha criada quando não há erro — null é
  // anômalo (mesmo padrão de createCompanyRpc).
  if (!data) {
    throw new PlatformCommercialError('platform_commercial_lead_create_failed', {
      operation: 'create_lead',
      message: 'empty_response',
    });
  }
  return data;
}

// Só os campos REAIS de update_lead — nenhum p_seller_id, nenhum campo de
// etapa/arquivamento (a RPC nem os aceita, ver decisão #8 do S8-C2-C2: editar
// nunca move Etapa nem atribui Vendedor).
export async function updatePlatformLead(input: UpdatePlatformLeadInput): Promise<PlatformLeadRecord> {
  const { data, error } = await supabase.rpc('update_lead', {
    p_company_id: input.companyId,
    p_lead_id: input.leadId,
    p_expected_version: input.expectedVersion,
    p_name: input.name,
    p_phone: input.phone,
    p_car: input.car,
    p_payment_preference: input.paymentPreference || undefined,
    p_source: input.source || undefined,
    p_temperature: input.temperature,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_lead_update_failed', {
      ...detailFrom(error),
      operation: 'update_lead',
    });
  }
  if (!data) {
    throw new PlatformCommercialError('platform_commercial_lead_update_failed', {
      operation: 'update_lead',
      message: 'empty_response',
    });
  }
  return data;
}

// Retorna a(s) linha(s) crua(s) de status — a interpretação (mensagem,
// bloqueio de submit) é do chamador (hook/formulário), nunca desta função.
// companyId SEMPRE explícito: mesmo a RPC aceitando p_company_id ausente,
// este wrapper nunca permite uma checagem sem escopo de empresa (decisão
// S8-C2-C2 §8 — duplicidade sempre escopada a selectedCompanyId, nunca
// global). p_phone NUNCA vira parte de uma query key — este é um
// useMutation, não um useQuery (ver hook).
export async function checkPlatformLeadPhoneDuplicate(
  companyId: string,
  phone: string,
): Promise<PlatformLeadDuplicateRow[]> {
  const { data, error } = await supabase.rpc('check_lead_phone_duplicate', {
    p_company_id: companyId,
    p_phone: phone,
  });
  if (error) {
    throw new PlatformCommercialError('platform_commercial_duplicate_check_failed', {
      ...detailFrom(error),
      operation: 'check_lead_phone_duplicate',
    });
  }
  return data ?? [];
}
