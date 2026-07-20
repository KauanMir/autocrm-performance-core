// Tipos manuais para as 3 tabelas do M1-B (companies/profiles/sellers) —
// preservados porque lib/services.ts depende deles. A partir do M1-D os tipos
// oficiais vivem em ./database.types.ts (gerados via
// `supabase gen types typescript --local`, nunca editados à mão); tipos novos
// devem DERIVAR de Database, como PipelineStageRow abaixo.
import type { Database } from './database.types';

export type UserRole = 'admin' | 'manager' | 'seller';

export interface CompanyRow {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string; // = auth.users.id
  // nullable desde o M1-F S1: um Super Admin de plataforma nunca tem
  // company_id (nenhuma membership de empresa) — ver platform_role abaixo.
  company_id: string | null;
  name: string;
  email: string;
  role: UserRole;
  // text, não uuid — casa com sellers.id (ver nota em supabase/migrations,
  // M1-B mantém os ids de vendedor do seed localStorage por enquanto).
  seller_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // M1-F S1/S3-B: platform_role é independente de role/company_id — só
  // 'super_admin' ou null, nunca lido como autoridade real no frontend
  // (ver lib/data.ts User.platformRole).
  platform_role: Database['public']['Enums']['platform_role'] | null;
}

// ── M1-D — derivados do schema gerado (não recriar manualmente) ──────────

export type PipelineStageRow =
  Database['public']['Tables']['pipeline_stages']['Row'];

export interface SellerRow {
  // text, não uuid nesta fase — ver nota acima e no README de supabase/.
  id: string;
  company_id: string;
  profile_id: string | null;
  name: string;
  first_name: string;
  team: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── M1-E — derivados do schema gerado (não recriar manualmente) ──────────
// Sem aliases de Insert/Update de leads/lead_timeline_entries de propósito:
// o frontend não possui grants de escrita nas tabelas — toda escrita passa
// pelas 9 RPCs abaixo.

type PublicFunctions = Database['public']['Functions'];

export type LeadRow = Database['public']['Tables']['leads']['Row'];
export type LeadTimelineEntryRow =
  Database['public']['Tables']['lead_timeline_entries']['Row'];

export type LeadUrgency = Database['public']['Enums']['lead_urgency'];
export type LeadTemperature = Database['public']['Enums']['lead_temperature'];
export type LeadEventType = Database['public']['Enums']['lead_event_type'];
export type LeadDuplicateStatus =
  Database['public']['Enums']['lead_duplicate_status'];

// Args/Returns das 9 RPCs do M1-E — contratos únicos de escrita (mais a
// leitura controlada de duplicidade). p_expected_version é obrigatório em
// update/assign/archive/unarchive e opcional em move (drag last-write-wins);
// value_amount não é parâmetro de nenhuma delas (design §1).
export type CreateLeadArgs = PublicFunctions['create_lead']['Args'];
export type CreateLeadResult = PublicFunctions['create_lead']['Returns'];

export type UpdateLeadArgs = PublicFunctions['update_lead']['Args'];
export type UpdateLeadResult = PublicFunctions['update_lead']['Returns'];

export type MoveLeadToStageArgs = PublicFunctions['move_lead_to_stage']['Args'];
export type MoveLeadToStageResult =
  PublicFunctions['move_lead_to_stage']['Returns'];

export type ApplyLeadEventArgs = PublicFunctions['apply_lead_event']['Args'];
export type ApplyLeadEventResult =
  PublicFunctions['apply_lead_event']['Returns'];

// O gerador do Supabase não representa nulabilidade de argumentos de função
// (p_seller_id text vira `string`), mas o contrato real da RPC aceita null
// para REMOVER o vendedor (design §6.5). Só a nulabilidade é sobrescrita —
// o restante da assinatura continua derivado de Database.
export type AssignLeadSellerArgs = Omit<
  PublicFunctions['assign_lead_seller']['Args'],
  'p_seller_id'
> & { p_seller_id: string | null };
export type AssignLeadSellerResult =
  PublicFunctions['assign_lead_seller']['Returns'];

export type ArchiveLeadArgs = PublicFunctions['archive_lead']['Args'];
export type ArchiveLeadResult = PublicFunctions['archive_lead']['Returns'];

export type UnarchiveLeadArgs = PublicFunctions['unarchive_lead']['Args'];
export type UnarchiveLeadResult = PublicFunctions['unarchive_lead']['Returns'];

export type AddLeadTimelineEntryArgs =
  PublicFunctions['add_lead_timeline_entry']['Args'];
export type AddLeadTimelineEntryResult =
  PublicFunctions['add_lead_timeline_entry']['Returns'];

export type CheckLeadPhoneDuplicateArgs =
  PublicFunctions['check_lead_phone_duplicate']['Args'];
// Retorno em linhas (§6.9): 1 linha 'none', N linhas 'accessible' e no máximo
// 1 linha 'restricted' — por isso o Returns já é um array tipado.
export type CheckLeadPhoneDuplicateResult =
  PublicFunctions['check_lead_phone_duplicate']['Returns'];
