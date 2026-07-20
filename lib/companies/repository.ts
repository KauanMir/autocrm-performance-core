// lib/companies/repository.ts — acesso remoto de companies para a tela
// administrativa da KAPA (M1-F S3-B). SOMENTE os dois caminhos aprovados no
// backend (S3-A): SELECT em public.companies (protegido pela RLS
// companies_select_accessible/can_access_company) e a RPC
// public.create_company(). Nenhum INSERT/UPDATE/DELETE direto, nenhum
// service_role, nenhum acesso a memberships/profiles/auth.users/stages.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { PlatformCompanyError } from '@/lib/companies/errors';

// Somente os campos exibidos pela tela (design §7.8: listagem global, sem
// empresa alvo) — created_by_profile_id não é selecionado por não ter uso
// visual nesta etapa.
export type PlatformCompanyRow = Pick<
  Database['public']['Tables']['companies']['Row'],
  'id' | 'name' | 'trade_name' | 'cnpj' | 'phone' | 'timezone' | 'status' | 'created_at'
>;

// Lê as empresas visíveis para a sessão atual. Nenhum filtro de usuário/
// empresa é enviado — a RLS decide sozinha (Super Admin: implantacao/ativa/
// suspensa, nunca cancelada, design §7.4/§8; Manager/Seller: só a própria
// empresa, se operacional). Ordenação estável e determinística.
export async function fetchAccessibleCompanies(): Promise<PlatformCompanyRow[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, trade_name, cnpj, phone, timezone, status, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e mensagem
    // do PostgREST — sem token, sem URL, sem query.
    throw new PlatformCompanyError('platform_companies_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as PlatformCompanyRow[];
}

export type CreateCompanyInput = {
  name: string;
  tradeName?: string;
  cnpj?: string;
  phone?: string;
  timezone?: string;
};

// Único caminho de criação. Payload contém EXATAMENTE os 5 campos que a RPC
// aceita — nenhum status/created_by_profile_id/id/company_id/profile_id é
// enviado (a assinatura da RPC nem os aceita, ver m1f_s3a_company_creation_
// backend.sql). Campo opcional vazio ('' do formulário) vira `undefined`
// (chave omitida) em vez de string vazia enviada de propósito — decisão da
// UI, não normalização do valor que o usuário efetivamente digitou: se o
// campo tem texto, ele vai exatamente como está.
export async function createCompanyRpc(input: CreateCompanyInput): Promise<PlatformCompanyRow> {
  const { data, error } = await supabase.rpc('create_company', {
    p_name: input.name,
    p_trade_name: input.tradeName || undefined,
    p_cnpj: input.cnpj || undefined,
    p_phone: input.phone || undefined,
    p_timezone: input.timezone || undefined,
  });

  if (error) {
    throw new PlatformCompanyError('platform_companies_create_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }
  // create_company sempre retorna a linha criada quando não há erro — null
  // é anômalo (mesmo padrão de useReorderStages).
  if (!data) {
    throw new PlatformCompanyError('platform_companies_create_failed', {
      operation: 'create_company',
      message: 'empty_response',
    });
  }

  return data as unknown as PlatformCompanyRow;
}
