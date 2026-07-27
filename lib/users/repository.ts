// lib/users/repository.ts — acesso remoto à listagem/edição administrativa
// de usuários ativos (M1-F S5-D). Três RPCs estreitas, SECURITY DEFINER,
// EXECUTE restrito a authenticated (S5-A2/S5-B/S5-C) — nunca SELECT/UPDATE
// direto em profiles/company_memberships/auth.users, nunca payload genérico.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { CompanyUserError } from '@/lib/users/errors';

// Tipos FECHADOS — literalmente as colunas que as RPCs devolvem (geradas a
// partir das migrations locais m1f_s5a2/s5b/s5c). Nunca reutiliza
// Database['public']['Tables']['profiles']['Row'] inteiro (esse carrega
// platform_role/seller_id/is_active — nenhum deles é retornado por
// list_company_users, ver §22.5 do design).
export type CompanyUserRow = Database['public']['Functions']['list_company_users']['Returns'][number];
export type UpdateProfileNameResult = Database['public']['Functions']['update_profile_name']['Returns'][number];
export type UpdateMembershipRoleResult = Database['public']['Functions']['update_membership_role']['Returns'][number];

export type CompanyUserCursor = { createdAt: string; membershipId: string };

export type FetchCompanyUsersParams = {
  limit: number;
  // null: primeira página (sem cursor). A RPC exige os dois lados do cursor
  // juntos ou nenhum — nunca um só.
  cursor: CompanyUserCursor | null;
  search: string | null;
  // Só tem efeito para Super Admin — a RPC ignora/deriva sozinha para
  // Manager (current_membership_company_id()), nunca autorização do cliente.
  companyId: string | null;
  role: 'manager' | 'seller' | null;
};

function isValidCompanyUserRow(row: unknown): row is CompanyUserRow {
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
    && typeof r.created_at === 'string'
  );
}

// Leitura paginada e autorizada (§22.5). Nenhum SELECT direto sobre
// profiles/company_memberships — a autorização/paginação/busca inteiras
// vivem dentro da RPC. Resposta validada linha a linha antes de chegar à UI
// — nunca confia cegamente no shape (mesmo padrão de cancelInviteRpc).
export async function fetchCompanyUsers(params: FetchCompanyUsersParams): Promise<CompanyUserRow[]> {
  const { data, error } = await supabase.rpc('list_company_users', {
    p_limit: params.limit,
    p_cursor_created_at: params.cursor?.createdAt ?? undefined,
    p_cursor_membership_id: params.cursor?.membershipId ?? undefined,
    p_search: params.search ?? undefined,
    p_company_id: params.companyId ?? undefined,
    p_role: params.role ?? undefined,
  });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e mensagem
    // do PostgREST — sem token, sem URL, sem query.
    throw new CompanyUserError('company_users_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.every(isValidCompanyUserRow)) {
    throw new CompanyUserError('company_users_invalid_response', { operation: 'list_company_users' });
  }
  return rows;
}

function isValidUpdateProfileNameResult(row: unknown): row is UpdateProfileNameResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return typeof r.profile_id === 'string' && typeof r.name === 'string' && typeof r.updated_at === 'string';
}

// Altera EXCLUSIVAMENTE profiles.name. O erro NUNCA é embrulhado aqui — o
// código de domínio (unauthenticated/forbidden/profile_not_found/
// user_inactive/invalid_name) chega em error.message vindo direto do `raise
// using message = '...'` da função (mesmo padrão de
// reorder_pipeline_stages/useReorderStages) — quem mapeia para texto em
// português é getUpdateProfileNameErrorMessage (lib/hooks/useUpdateProfileName.ts).
export async function updateProfileNameRpc(targetProfileId: string, name: string): Promise<UpdateProfileNameResult> {
  const { data, error } = await supabase.rpc('update_profile_name', {
    p_target_profile_id: targetProfileId,
    p_name: name,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidUpdateProfileNameResult(row)) {
    throw new CompanyUserError('company_users_invalid_response', { operation: 'update_profile_name' });
  }
  return row;
}

function isValidUpdateMembershipRoleResult(row: unknown): row is UpdateMembershipRoleResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.membership_id === 'string'
    && typeof r.profile_id === 'string'
    && typeof r.company_id === 'string'
    && (r.company_role === 'manager' || r.company_role === 'seller')
  );
}

// Altera EXCLUSIVAMENTE company_memberships.role (seller ↔ manager),
// exclusiva de Super Admin — a própria RPC recusa Manager/Seller/self/outro
// Super Admin/último Manager (P0001 last_manager_requires_successor,
// self_role_change_forbidden, seller_state_conflict). Mesmo padrão de erro
// cru de updateProfileNameRpc.
export async function updateMembershipRoleRpc(
  membershipId: string,
  companyId: string,
  role: 'manager' | 'seller',
): Promise<UpdateMembershipRoleResult> {
  const { data, error } = await supabase.rpc('update_membership_role', {
    p_membership_id: membershipId,
    p_company_id: companyId,
    p_role: role,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidUpdateMembershipRoleResult(row)) {
    throw new CompanyUserError('company_users_invalid_response', { operation: 'update_membership_role' });
  }
  return row;
}
