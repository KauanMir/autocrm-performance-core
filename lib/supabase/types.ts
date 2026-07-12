// Tipos manuais para as 3 tabelas desta fase (M1-B: companies/profiles/sellers).
// Não gerados via `supabase gen types typescript` porque ainda não existe um
// projeto Supabase real conectado a este repositório — quando existir, troque
// este arquivo pela saída do CLI e mantenha só os alias que o resto do app usa.

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
