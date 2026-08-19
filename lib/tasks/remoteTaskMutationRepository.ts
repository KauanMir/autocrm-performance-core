// lib/tasks/remoteTaskMutationRepository.ts — mutations remotas de Tasks
// (COMMERCIAL-REMOTE-B1-B2-C1): createRemoteTask/updateRemoteTask/
// completeRemoteTask. Sem React, sem localStorage, sem TaskService, sem
// LeadService/SellerService, sem queryClient/snapshot/bridge — responsabilidade
// única: payload TypeScript → RPC Supabase → RemoteTaskRow cru. Cache,
// invalidação e notificação de bridge são responsabilidade dos hooks
// futuros (B1-B2-C2), nunca deste módulo (mesma separação de
// lib/leads/remoteMutationRepository.ts).
//
// Contrato reconfirmado diretamente em supabase/migrations/
// 20260819100000_commercial_remote_b1_tasks.sql (nunca só pelos relatórios
// anteriores) — create_task/update_task/complete_task não aceitam
// p_company_id (diferente de create_lead/update_lead): resolve_commercial_
// mutation_context() deriva a empresa SEMPRE de auth.uid() via
// company_memberships, sem parâmetro de compatibilidade nesta primeira
// etapa (precheck B1 §12). Nenhum p_company_id é enviado por este
// repository.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { mapRemoteTasksMutationError } from '@/lib/tasks/errors';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

// ── create_task ───────────────────────────────────────────────────────────
// p_title/p_priority/p_due_at obrigatórios (sem default no SQL);
// p_assigned_seller_id/p_lead_id/p_note têm default null/null/'' no SQL —
// espelhados aqui como opcionais. Regra de negócio "Manager precisa
// escolher um Seller" (seller_required) é decidida pelo BACKEND (RPC) e,
// no próximo lote, pelos hooks — este repository nunca resolve/valida
// Seller, só representa o contrato (precheck §6).
export type CreateRemoteTaskPayload = {
  title: string;
  priority: Database['public']['Enums']['task_priority'];
  dueAt: string;
  assignedSellerId?: string | null;
  leadId?: string | null;
  note?: string;
};

// ── update_task ──────────────────────────────────────────────────────────
// PONTO CRÍTICO (precheck §7/§9): update_task é FULL REPLACE, nunca PATCH
// parcial — todos os campos são obrigatórios no SQL (sem default). Por
// isso NENHUM campo aqui é opcional/Partial: uma chamada que omita
// title/note/priority/assignedSellerId (ex.: só para reagendar due_at)
// FALHA em tempo de compilação, nunca em runtime — impossível apagar um
// campo por omissão. `assignedSellerId` é `string` (não `string | null`)
// de propósito: embora a coluna do banco permita NULL e o gerador do
// Supabase não modele nulabilidade de args (mesmo caso de
// lib/leads/remoteMutationRepository.ts:assign_lead_seller), o contrato
// de negócio real do próprio update_task exige um Seller responsável
// concreto em toda chamada — Manager sempre reatribui para um Seller
// real (seller_required se null) e Seller só pode reenviar o PRÓPRIO id
// atual (nunca null, porque create_task já exige um Seller na criação).
export type UpdateRemoteTaskPayload = {
  taskId: string;
  expectedVersion: number;
  title: string;
  note: string;
  priority: Database['public']['Enums']['task_priority'];
  dueAt: string;
  assignedSellerId: string;
};

// ── complete_task ────────────────────────────────────────────────────────
// Somente identidade + concorrência otimista — status/completedAt/
// completedBy são inteiramente resolvidos pelo backend (`now()`,
// v_ctx.actor_profile_id); o cliente nunca os declara.
export type CompleteRemoteTaskPayload = {
  taskId: string;
  expectedVersion: number;
};

// create_task sempre retorna a linha criada quando não há erro — data=null
// sem error é anômalo (mesmo padrão de createRemoteLead/createCompanyRpc).
export async function createRemoteTask(payload: CreateRemoteTaskPayload): Promise<RemoteTaskRow> {
  const { data, error } = await supabase.rpc('create_task', {
    p_title: payload.title,
    p_priority: payload.priority,
    p_due_at: payload.dueAt,
    p_assigned_seller_id: payload.assignedSellerId ?? null,
    p_lead_id: payload.leadId ?? null,
    p_note: payload.note ?? '',
  });
  if (error) throw mapRemoteTasksMutationError(error, 'create_task');
  if (!data) throw mapRemoteTasksMutationError({ message: 'empty_response' }, 'create_task');
  return data as RemoteTaskRow;
}

// Nenhum campo omitido — reagendar due_at, por exemplo, exige reenviar
// title/note/priority/assignedSellerId ATUAIS (o caller, não este
// repository, é quem busca o valor atual antes de montar o payload).
export async function updateRemoteTask(payload: UpdateRemoteTaskPayload): Promise<RemoteTaskRow> {
  const { data, error } = await supabase.rpc('update_task', {
    p_id: payload.taskId,
    p_expected_version: payload.expectedVersion,
    p_title: payload.title,
    p_note: payload.note,
    p_priority: payload.priority,
    p_due_at: payload.dueAt,
    p_assigned_seller_id: payload.assignedSellerId,
  });
  if (error) throw mapRemoteTasksMutationError(error, 'update_task');
  if (!data) throw mapRemoteTasksMutationError({ message: 'empty_response' }, 'update_task');
  return data as RemoteTaskRow;
}

export async function completeRemoteTask(payload: CompleteRemoteTaskPayload): Promise<RemoteTaskRow> {
  const { data, error } = await supabase.rpc('complete_task', {
    p_id: payload.taskId,
    p_expected_version: payload.expectedVersion,
  });
  if (error) throw mapRemoteTasksMutationError(error, 'complete_task');
  if (!data) throw mapRemoteTasksMutationError({ message: 'empty_response' }, 'complete_task');
  return data as RemoteTaskRow;
}
