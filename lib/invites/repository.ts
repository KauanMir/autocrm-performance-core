// lib/invites/repository.ts — acesso remoto de leitura E cancelamento
// administrativo de convites (M1-F S4-F1/S4-F3). Leitura: SELECT em
// public.invites, protegido por RLS (invites_select_own_or_platform) E por
// GRANT de coluna (20260722100100_m1f_s4f1_02_invites_column_grants.sql —
// nunca token_hash/email_normalized/accepted_profile_id/updated_at).
// Cancelamento (M1-F S4-F3): exclusivamente via RPC cancel_invite() —
// SECURITY DEFINER, EXECUTE concedido a authenticated (m1f_s4a2a), revalida
// auth.uid()/ator/empresa/invited_by_profile_id internamente. Nunca UPDATE
// direto na tabela, nunca service_role. Criação (POST /api/platform/
// invites) e reenvio (POST /api/platform/invites/[id]/resend) ficam em
// arquivos próprios (createInviteRequest.ts/resendInviteRequest.ts) por
// exigirem o Route Handler/Admin API — este arquivo é só PostgREST/RPC.
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

// M1-F S4-F3 — resultado discriminado e fechado, nunca a resposta bruta do
// PostgREST/RPC. `code` é o subconjunto de códigos de domínio que
// cancel_invite() pode devolver (invite_not_found/invite_not_actionable) —
// nunca importado de lib/server/* (esta função nunca passa pelo Route
// Handler, é RPC direta via PostgREST).
export type CancelInviteResult =
  | { outcome: 'ok'; inviteId: string; status: string }
  | { outcome: 'domain_error'; code: string }
  | { outcome: 'error' };

// Único caminho de cancelamento: RPC cancel_invite(p_invite_id) —
// SECURITY DEFINER, EXECUTE concedido a authenticated, ator sempre
// auth.uid() nativo dentro da função (nunca um parâmetro vindo do
// cliente). Nunca UPDATE direto em public.invites (sem GRANT de escrita
// para authenticated, ver testes 22/29), nunca service_role.
export async function cancelInviteRpc(inviteId: string): Promise<CancelInviteResult> {
  const { data, error } = await supabase.rpc('cancel_invite', { p_invite_id: inviteId });

  if (error) {
    return { outcome: 'error' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (
    !row
    || typeof row !== 'object'
    || typeof (row as { success?: unknown }).success !== 'boolean'
    || typeof (row as { code?: unknown }).code !== 'string'
  ) {
    return { outcome: 'error' };
  }

  const typed = row as { success: boolean; code: string; invite_id: string | null; status: string | null };

  if (!typed.success) {
    return { outcome: 'domain_error', code: typed.code };
  }

  if (typeof typed.invite_id !== 'string' || typeof typed.status !== 'string') {
    return { outcome: 'error' };
  }

  return { outcome: 'ok', inviteId: typed.invite_id, status: typed.status };
}
