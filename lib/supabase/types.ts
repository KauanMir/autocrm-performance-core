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
  company_id: string;
  name: string;
  email: string;
  role: UserRole;
  // text, não uuid — casa com sellers.id (ver nota em supabase/migrations,
  // M1-B mantém os ids de vendedor do seed localStorage por enquanto).
  seller_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
