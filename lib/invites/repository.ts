// lib/invites/repository.ts — acesso remoto de leitura administrativa de
// convites (M1-F S4-F1). SOMENTE o caminho aprovado nesta etapa: SELECT em
// public.invites, protegido por RLS (invites_select_own_or_platform) E por
// GRANT de coluna (20260722100100_m1f_s4f1_02_invites_column_grants.sql —
// nunca token_hash/email_normalized/accepted_profile_id/updated_at).
// Nenhum INSERT/UPDATE/DELETE, nenhum service_role, nenhuma criação/
// reenvio/cancelamento nesta etapa (S4-F2/S4-F3).
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { AdminInviteError } from '@/lib/invites/errors';
import type { AdminInviteScope } from '@/lib/invites/queryKeys';

const ADMIN_INVITE_SELECT_COLUMNS =
  'id, company_id, invited_by_profile_id, name, email, role_kind, status, expires_at, accepted_at, created_at';

// Tipo FECHADO — Pick literal das 10 colunas concedidas nesta etapa. Nunca
// reutiliza Database['public']['Tables']['invites']['Row'] inteiro (esse
// carrega token_hash/email_normalized/accepted_profile_id/delivery_*/
// updated_at/supersedes_invite_id — nenhum deles pertence à listagem
// administrativa nem foi concedido por GRANT ao frontend).
export type AdminInviteListItem = Pick<
  Database['public']['Tables']['invites']['Row'],
  'id' | 'company_id' | 'invited_by_profile_id' | 'name' | 'email' | 'role_kind' | 'status' | 'expires_at' | 'accepted_at' | 'created_at'
>;

export type { AdminInviteScope } from '@/lib/invites/queryKeys';

// Lê os convites visíveis para o escopo pedido. Escopo SEMPRE explícito —
// nunca "empresa atual" implícita, nunca localStorage, nunca inferido no
// servidor. RLS continua sendo a autoridade real de LINHA (Manager só vê
// os que ele mesmo enviou, Super Admin vê todos) — o filtro de company_id
// aqui é defesa/coerência de escopo, nunca substitui a RLS: um Manager que
// tentasse informar companyId de outra empresa continuaria vendo zero
// linhas (RLS nega antes disso importar).
export async function fetchInvites(scope: AdminInviteScope): Promise<AdminInviteListItem[]> {
  let query = supabase
    .from('invites')
    .select(ADMIN_INVITE_SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (scope.kind === 'company') {
    query = query.eq('company_id', scope.companyId);
  }
  // scope.kind === 'platform': nenhum filtro adicional de empresa — Super
  // Admin vê exatamente o que invites_select_own_or_platform permitir
  // (todos os convites). Nenhum seletor de empresa nesta etapa (S7).

  const { data, error } = await query;

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem hash, sem URL, sem query.
    throw new AdminInviteError('admin_invites_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as AdminInviteListItem[];
}
