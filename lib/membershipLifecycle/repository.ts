// lib/membershipLifecycle/repository.ts — acesso remoto ao ciclo de vida
// empresarial (M1-F S6-F): suspend_membership/reactivate_membership (S6-B),
// offboard_seller/offboard_manager (S6-C, contrato de sucessor endurecido em
// S6-E2), transfer_membership (S6-D). Cinco RPCs estreitas, SECURITY
// DEFINER, EXECUTE restrito a authenticated — nunca SELECT/UPDATE direto em
// company_memberships/sellers/profiles, nunca payload genérico.
//
// Contratos EXATOS (relidos das migrations/database.types.ts antes de
// escrever qualquer chamada — nunca presumidos):
//   suspend_membership(p_membership_id uuid, p_note text)
//   reactivate_membership(p_membership_id uuid, p_note text default null)
//   offboard_seller(p_seller_membership_id uuid, p_successor_membership_id uuid, p_note text)
//   offboard_manager(p_manager_membership_id uuid, p_successor_profile_id uuid, p_note text)
//   transfer_membership(p_source_membership_id uuid, p_target_company_id uuid,
//                        p_target_role company_role, p_successor_id uuid, p_note text)
//
// Ponto crítico (§ auditoria S6-D): offboard_seller usa p_successor_membership_id
// (uuid de company_memberships) — transfer_membership usa p_successor_id, que é
// PROFILE_ID (uuid de profiles), resolvido internamente pela RPC via a
// membership ativa do sucessor NA EMPRESA DE ORIGEM. Os dois tipos nunca são
// intercambiáveis — cada função abaixo recebe exatamente o tipo que sua RPC
// espera, nomeado sem ambiguidade nos parâmetros TypeScript.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { MembershipLifecycleError } from '@/lib/membershipLifecycle/errors';

export type SuspendMembershipResult = Database['public']['Functions']['suspend_membership']['Returns'][number];
export type ReactivateMembershipResult = Database['public']['Functions']['reactivate_membership']['Returns'][number];
export type OffboardSellerResult = Database['public']['Functions']['offboard_seller']['Returns'][number];
export type OffboardManagerResult = Database['public']['Functions']['offboard_manager']['Returns'][number];
export type TransferMembershipResult = Database['public']['Functions']['transfer_membership']['Returns'][number];

function isValidSuspendOrReactivateResult(row: unknown): row is SuspendMembershipResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.membership_id === 'string'
    && typeof r.profile_id === 'string'
    && typeof r.company_id === 'string'
    && (r.company_role === 'manager' || r.company_role === 'seller')
    && (r.lifecycle_status === 'active' || r.lifecycle_status === 'suspended' || r.lifecycle_status === 'offboarded')
    && typeof r.is_active === 'boolean'
  );
}

export async function suspendMembershipRpc(membershipId: string, note: string): Promise<SuspendMembershipResult> {
  const { data, error } = await supabase.rpc('suspend_membership', { p_membership_id: membershipId, p_note: note });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidSuspendOrReactivateResult(row)) {
    throw new MembershipLifecycleError('membership_lifecycle_invalid_response', { operation: 'suspend_membership' });
  }
  return row;
}

export async function reactivateMembershipRpc(membershipId: string, note: string | null): Promise<ReactivateMembershipResult> {
  const { data, error } = await supabase.rpc('reactivate_membership', {
    p_membership_id: membershipId,
    p_note: note ?? undefined,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidSuspendOrReactivateResult(row)) {
    throw new MembershipLifecycleError('membership_lifecycle_invalid_response', { operation: 'reactivate_membership' });
  }
  return row;
}

function isValidOffboardSellerResult(row: unknown): row is OffboardSellerResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.membership_id === 'string'
    && typeof r.profile_id === 'string'
    && typeof r.company_id === 'string'
    && r.company_role === 'seller'
    && (r.lifecycle_status === 'active' || r.lifecycle_status === 'suspended' || r.lifecycle_status === 'offboarded')
    && typeof r.is_active === 'boolean'
    && typeof r.leads_reassigned === 'number'
  );
}

// p_successor_membership_id: uuid de company_memberships (nunca sellers.id —
// endurecido em S6-E2). null explícito quando não há sucessor — a RPC decide
// se isso é permitido (successor_required quando há lead aberto).
export async function offboardSellerRpc(
  sellerMembershipId: string,
  successorMembershipId: string | null,
  note: string,
): Promise<OffboardSellerResult> {
  const { data, error } = await supabase.rpc('offboard_seller', {
    p_seller_membership_id: sellerMembershipId,
    p_successor_membership_id: successorMembershipId ?? undefined,
    p_note: note,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidOffboardSellerResult(row)) {
    throw new MembershipLifecycleError('membership_lifecycle_invalid_response', { operation: 'offboard_seller' });
  }
  return row;
}

function isValidOffboardManagerResult(row: unknown): row is OffboardManagerResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.membership_id === 'string'
    && typeof r.profile_id === 'string'
    && typeof r.company_id === 'string'
    && r.company_role === 'manager'
    && (r.lifecycle_status === 'active' || r.lifecycle_status === 'suspended' || r.lifecycle_status === 'offboarded')
    && typeof r.is_active === 'boolean'
  );
}

// p_successor_profile_id: uuid de profiles — precisa JÁ ser Manager ativo da
// mesma empresa (a RPC nunca promove implicitamente). null explícito quando
// não há sucessor — obrigatório apenas quando o alvo é o último Manager
// ativo (last_manager_requires_successor).
export async function offboardManagerRpc(
  managerMembershipId: string,
  successorProfileId: string | null,
  note: string,
): Promise<OffboardManagerResult> {
  const { data, error } = await supabase.rpc('offboard_manager', {
    p_manager_membership_id: managerMembershipId,
    p_successor_profile_id: successorProfileId ?? undefined,
    p_note: note,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidOffboardManagerResult(row)) {
    throw new MembershipLifecycleError('membership_lifecycle_invalid_response', { operation: 'offboard_manager' });
  }
  return row;
}

function isValidTransferMembershipResult(row: unknown): row is TransferMembershipResult {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.profile_id === 'string'
    && typeof r.source_membership_id === 'string'
    && typeof r.destination_membership_id === 'string'
    && typeof r.source_company_id === 'string'
    && typeof r.destination_company_id === 'string'
    && (r.destination_role === 'manager' || r.destination_role === 'seller')
    && typeof r.leads_reassigned === 'number'
  );
}

// p_successor_id: uuid de PROFILES (nunca membership_id/seller_id) — a RPC
// resolve internamente a membership ativa desse profile NA EMPRESA DE
// ORIGEM, com o mesmo role da origem (seller sucede seller, manager sucede
// manager). Ver nota de topo do arquivo — tipo deliberadamente distinto de
// offboard_seller.
export async function transferMembershipRpc(
  sourceMembershipId: string,
  targetCompanyId: string,
  targetRole: Database['public']['Enums']['company_role'],
  successorProfileId: string | null,
  note: string,
): Promise<TransferMembershipResult> {
  const { data, error } = await supabase.rpc('transfer_membership', {
    p_source_membership_id: sourceMembershipId,
    p_target_company_id: targetCompanyId,
    p_target_role: targetRole,
    p_successor_id: successorProfileId ?? undefined,
    p_note: note,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!isValidTransferMembershipResult(row)) {
    throw new MembershipLifecycleError('membership_lifecycle_invalid_response', { operation: 'transfer_membership' });
  }
  return row;
}
