// lib/inactiveUsers/repository.ts — acesso remoto à leitura administrativa
// de memberships inativas (suspensas/desligadas) (M1-F S6-E). Uma única RPC
// estreita, SECURITY DEFINER, EXECUTE restrito a authenticated — nunca
// SELECT direto em profiles/company_memberships, nunca payload genérico.
// Mesmo padrão de lib/users/repository.ts (fetchCompanyUsers).
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { InactiveCompanyUserError } from '@/lib/inactiveUsers/errors';

// Tipo FECHADO — literalmente as colunas que a RPC devolve (gerada a partir
// da migration local m1f_s6e). Nunca reutiliza
// Database['public']['Tables']['profiles']['Row'] inteiro nem
// ['company_memberships']['Row'] inteiro.
export type InactiveCompanyUserRow = Database['public']['Functions']['list_inactive_company_users']['Returns'][number];

export type InactiveCompanyUserCursor = { updatedAt: string; membershipId: string };

export type FetchInactiveCompanyUsersParams = {
  limit: number;
  // null: primeira página (sem cursor). A RPC exige os dois lados do cursor
  // juntos ou nenhum — nunca um só.
  cursor: InactiveCompanyUserCursor | null;
  search: string | null;
  // Só tem efeito para Super Admin — a RPC ignora/deriva sozinha para
  // Manager (current_membership_company_id()), nunca autorização do cliente.
  companyId: string | null;
  // Só tem efeito para Super Admin — a RPC força 'seller' para Manager,
  // independente do que for enviado aqui (Manager nunca vê Managers
  // inativos, §24.14 do design).
  role: 'manager' | 'seller' | null;
  // null = suspensos e desligados juntos. 'active' nunca é um valor válido
  // aqui (a RPC rejeita explicitamente com invalid_lifecycle).
  lifecycle: 'suspended' | 'offboarded' | null;
};

function isValidInactiveCompanyUserRow(row: unknown): row is InactiveCompanyUserRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.profile_id === 'string'
    && typeof r.membership_id === 'string'
    && typeof r.name === 'string'
    && typeof r.email === 'string'
    && typeof r.company_id === 'string'
    && typeof r.company_name === 'string'
    && (r.company_role === 'manager' || r.company_role === 'seller')
    && (r.lifecycle_status === 'suspended' || r.lifecycle_status === 'offboarded')
    && typeof r.is_active === 'boolean'
    && typeof r.created_at === 'string'
    && typeof r.updated_at === 'string'
  );
}

// Leitura paginada e autorizada. Nenhum SELECT direto sobre profiles/
// company_memberships — a autorização/paginação/busca inteiras vivem dentro
// da RPC. Resposta validada linha a linha antes de chegar à UI — nunca
// confia cegamente no shape (mesmo padrão de fetchCompanyUsers).
export async function fetchInactiveCompanyUsers(params: FetchInactiveCompanyUsersParams): Promise<InactiveCompanyUserRow[]> {
  const { data, error } = await supabase.rpc('list_inactive_company_users', {
    p_limit: params.limit,
    p_cursor_updated_at: params.cursor?.updatedAt ?? undefined,
    p_cursor_membership_id: params.cursor?.membershipId ?? undefined,
    p_search: params.search ?? undefined,
    p_company_id: params.companyId ?? undefined,
    p_role: params.role ?? undefined,
    p_lifecycle: params.lifecycle ?? undefined,
  });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e mensagem
    // do PostgREST — sem token, sem URL, sem query.
    throw new InactiveCompanyUserError('inactive_company_users_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.every(isValidInactiveCompanyUserRow)) {
    throw new InactiveCompanyUserError('inactive_company_users_invalid_response', { operation: 'list_inactive_company_users' });
  }
  return rows;
}
