// lib/visits/remoteMutationRepository.ts — mutations remotas de Visits
// (COMMERCIAL-REMOTE-VISITS-B2-B): createRemoteVisit/updateRemoteVisit/
// confirmRemoteVisit/cancelRemoteVisit/registerRemoteVisitResult. Sem
// React, sem localStorage, sem VisitService/LeadService/SellerService, sem
// queryClient/snapshot — responsabilidade única: payload TypeScript → RPC
// Supabase → RemoteVisitRow cru. Cache, invalidação e notificação são
// responsabilidade dos hooks (mesma separação de
// lib/tasks/remoteTaskMutationRepository.ts).
//
// Contrato reconfirmado diretamente em supabase/migrations/
// 20260821100000_commercial_remote_visits_b1.sql (nunca só pelos relatórios
// anteriores) — nenhuma das 5 RPCs aceita p_company_id:
// resolve_commercial_mutation_context() deriva a empresa SEMPRE de
// auth.uid() via company_memberships, mesmo contrato de Tasks. Nenhum
// p_company_id é enviado por este repository. Nenhuma regra de negócio
// (seller default do Lead, reschedule resetando status, etc.) é decidida
// aqui — o backend é a única autoridade; este módulo só representa o
// contrato.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import type { RemoteVisitRow } from '@/lib/visits/adapter';

type VisitOutcome = Database['public']['Enums']['visit_outcome'];

// ── create_visit ──────────────────────────────────────────────────────────
// p_scheduled_at/p_vehicles obrigatórios (sem default no SQL);
// p_lead_id/p_client_name/p_assigned_seller_id/p_note têm default null/
// null/null/'' no SQL — espelhados aqui como opcionais. Seller default a
// partir do Lead, seller_required, client_name_required etc. são decididos
// pelo BACKEND (RPC) — este repository nunca resolve/valida nada disso.
export type CreateRemoteVisitPayload = {
  scheduledAt: string;
  vehicles: readonly string[];
  leadId?: string | null;
  clientName?: string | null;
  assignedSellerId?: string | null;
  note?: string;
};

// ── update_visit ─────────────────────────────────────────────────────────
// PONTO CRÍTICO (mesmo de update_task): update_visit é FULL REPLACE, nunca
// PATCH parcial — scheduledAt/vehicles/note/assignedSellerId são todos
// obrigatórios no SQL (sem default). Por isso nenhum campo aqui é
// opcional/Partial. O reset confirmed→scheduled quando scheduled_at muda
// NÃO é calculado aqui — é a RPC quem decide (migration §16).
export type UpdateRemoteVisitPayload = {
  visitId: string;
  expectedVersion: number;
  scheduledAt: string;
  vehicles: readonly string[];
  note: string;
  assignedSellerId: string;
};

// ── confirm_visit ────────────────────────────────────────────────────────
export type ConfirmRemoteVisitPayload = {
  visitId: string;
  expectedVersion: number;
};

// ── cancel_visit ─────────────────────────────────────────────────────────
export type CancelRemoteVisitPayload = {
  visitId: string;
  expectedVersion: number;
};

// ── register_visit_result ────────────────────────────────────────────────
// outcome tipado a partir do schema gerado (Database['public']['Enums']
// ['visit_outcome']) — só aceita sold/negotiating/thinking/no_interest em
// tempo de compilação. resultNote nunca sobrescreve note (campo separado
// no banco, migration §5).
export type RegisterRemoteVisitResultPayload = {
  visitId: string;
  expectedVersion: number;
  outcome: VisitOutcome;
  resultNote?: string;
};

// create_visit sempre retorna a linha criada quando não há erro — data=null
// sem error é anômalo (mesmo padrão de createRemoteTask/createRemoteLead).
export async function createRemoteVisit(payload: CreateRemoteVisitPayload): Promise<RemoteVisitRow> {
  const { data, error } = await supabase.rpc('create_visit', {
    p_scheduled_at: payload.scheduledAt,
    p_vehicles: payload.vehicles as string[],
    p_lead_id: payload.leadId ?? null,
    p_client_name: payload.clientName ?? null,
    p_assigned_seller_id: payload.assignedSellerId ?? null,
    p_note: payload.note ?? '',
  });
  if (error) throw mapRemoteVisitsMutationError(error, 'create_visit');
  if (!data) throw mapRemoteVisitsMutationError({ message: 'empty_response' }, 'create_visit');
  return data as RemoteVisitRow;
}

// Nenhum campo omitido — reagendar scheduled_at, por exemplo, exige
// reenviar vehicles/note/assignedSellerId ATUAIS (o caller, não este
// repository, é quem busca o valor atual antes de montar o payload).
export async function updateRemoteVisit(payload: UpdateRemoteVisitPayload): Promise<RemoteVisitRow> {
  const { data, error } = await supabase.rpc('update_visit', {
    p_id: payload.visitId,
    p_expected_version: payload.expectedVersion,
    p_scheduled_at: payload.scheduledAt,
    p_vehicles: payload.vehicles as string[],
    p_note: payload.note,
    p_assigned_seller_id: payload.assignedSellerId,
  });
  if (error) throw mapRemoteVisitsMutationError(error, 'update_visit');
  if (!data) throw mapRemoteVisitsMutationError({ message: 'empty_response' }, 'update_visit');
  return data as RemoteVisitRow;
}

export async function confirmRemoteVisit(payload: ConfirmRemoteVisitPayload): Promise<RemoteVisitRow> {
  const { data, error } = await supabase.rpc('confirm_visit', {
    p_id: payload.visitId,
    p_expected_version: payload.expectedVersion,
  });
  if (error) throw mapRemoteVisitsMutationError(error, 'confirm_visit');
  if (!data) throw mapRemoteVisitsMutationError({ message: 'empty_response' }, 'confirm_visit');
  return data as RemoteVisitRow;
}

export async function cancelRemoteVisit(payload: CancelRemoteVisitPayload): Promise<RemoteVisitRow> {
  const { data, error } = await supabase.rpc('cancel_visit', {
    p_id: payload.visitId,
    p_expected_version: payload.expectedVersion,
  });
  if (error) throw mapRemoteVisitsMutationError(error, 'cancel_visit');
  if (!data) throw mapRemoteVisitsMutationError({ message: 'empty_response' }, 'cancel_visit');
  return data as RemoteVisitRow;
}

export async function registerRemoteVisitResult(payload: RegisterRemoteVisitResultPayload): Promise<RemoteVisitRow> {
  const { data, error } = await supabase.rpc('register_visit_result', {
    p_id: payload.visitId,
    p_expected_version: payload.expectedVersion,
    p_outcome: payload.outcome,
    p_result_note: payload.resultNote ?? '',
  });
  if (error) throw mapRemoteVisitsMutationError(error, 'register_visit_result');
  if (!data) throw mapRemoteVisitsMutationError({ message: 'empty_response' }, 'register_visit_result');
  return data as RemoteVisitRow;
}
