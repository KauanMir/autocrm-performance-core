// lib/followupTemplates/mutationRepository.ts — mutations remotas de
// Follow-up Templates (FOLLOW-UP-TEMPLATES-A3-EXEC). Sem React, sem cache —
// responsabilidade única: payload TypeScript → RPC Supabase → model. Mesmo
// molde de lib/tasks/remoteTaskMutationRepository.ts.
//
// Contrato reconfirmado diretamente em supabase/migrations/
// 20260826110000_followup_templates_a2_backend.sql (nunca só por memória):
// as 4 RPCs de escrita aceitam `p_company_id` OPCIONAL no final —
// Manager/Seller: sempre ignorado pelo backend (empresa vem da própria
// membership); Super Admin contextual: obrigatório na prática (o backend
// nega com company_required se vier null). Este repository só representa o
// contrato — quem decide SE envia companyId é o hook (actorKind).
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { adaptFollowUpTemplateRow, adaptFollowUpTemplateRows, type FollowUpTemplateModel, type FollowUpTemplateRow } from '@/lib/followupTemplates/adapter';

type TaskPriority = Database['public']['Enums']['task_priority'];

export type CreateRemoteFollowUpTemplatePayload = {
  name: string;
  taskTitle: string;
  priority: TaskPriority;
  offsetValue: number;
  offsetUnit: string;
  taskNote?: string;
  defaultTime?: string | null;
  sortOrder?: number | null;
  companyId?: string | null;
};

// FULL REPLACE (mesmo contrato de update_task) — todos os campos de
// conteúdo são obrigatórios aqui, nenhum opcional além de companyId.
export type UpdateRemoteFollowUpTemplatePayload = {
  templateId: string;
  expectedVersion: number;
  name: string;
  taskTitle: string;
  taskNote: string;
  priority: TaskPriority;
  offsetValue: number;
  offsetUnit: string;
  defaultTime: string | null;
  companyId?: string | null;
};

export type SetRemoteFollowUpTemplateActivePayload = {
  templateId: string;
  expectedVersion: number;
  isActive: boolean;
  companyId?: string | null;
};

export type ReorderRemoteFollowUpTemplatesPayload = {
  orderedIds: readonly string[];
  companyId?: string | null;
};

export async function createRemoteFollowUpTemplate(payload: CreateRemoteFollowUpTemplatePayload): Promise<FollowUpTemplateModel> {
  const { data, error } = await supabase.rpc('create_followup_template', {
    p_name: payload.name,
    p_task_title: payload.taskTitle,
    p_priority: payload.priority,
    p_offset_value: payload.offsetValue,
    p_offset_unit: payload.offsetUnit,
    p_task_note: payload.taskNote ?? '',
    p_default_time: payload.defaultTime ?? null,
    p_sort_order: payload.sortOrder ?? null,
    p_company_id: payload.companyId ?? null,
  });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'create_followup_template');
  if (!data) throw mapRemoteFollowUpTemplatesMutationError({ message: 'empty_response' }, 'create_followup_template');
  return adaptFollowUpTemplateRow(data as unknown as FollowUpTemplateRow);
}

export async function updateRemoteFollowUpTemplate(payload: UpdateRemoteFollowUpTemplatePayload): Promise<FollowUpTemplateModel> {
  const { data, error } = await supabase.rpc('update_followup_template', {
    p_id: payload.templateId,
    p_expected_version: payload.expectedVersion,
    p_name: payload.name,
    p_task_title: payload.taskTitle,
    p_task_note: payload.taskNote,
    p_priority: payload.priority,
    p_offset_value: payload.offsetValue,
    p_offset_unit: payload.offsetUnit,
    p_default_time: payload.defaultTime,
    p_company_id: payload.companyId ?? null,
  });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'update_followup_template');
  if (!data) throw mapRemoteFollowUpTemplatesMutationError({ message: 'empty_response' }, 'update_followup_template');
  return adaptFollowUpTemplateRow(data as unknown as FollowUpTemplateRow);
}

export async function setRemoteFollowUpTemplateActive(payload: SetRemoteFollowUpTemplateActivePayload): Promise<FollowUpTemplateModel> {
  const { data, error } = await supabase.rpc('set_followup_template_active', {
    p_id: payload.templateId,
    p_expected_version: payload.expectedVersion,
    p_is_active: payload.isActive,
    p_company_id: payload.companyId ?? null,
  });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'set_followup_template_active');
  if (!data) throw mapRemoteFollowUpTemplatesMutationError({ message: 'empty_response' }, 'set_followup_template_active');
  return adaptFollowUpTemplateRow(data as unknown as FollowUpTemplateRow);
}

// Payload atômico — nunca N updates individuais pelo browser (precheck
// A3-EXEC §16). Array NOVO e mutável enviado à RPC — o array recebido nunca
// é modificado (mesmo cuidado de useReorderStages).
export async function reorderRemoteFollowUpTemplates(payload: ReorderRemoteFollowUpTemplatesPayload): Promise<FollowUpTemplateModel[]> {
  const { data, error } = await supabase.rpc('reorder_followup_templates', {
    p_ordered_ids: [...payload.orderedIds],
    p_company_id: payload.companyId ?? null,
  });
  if (error) throw mapRemoteFollowUpTemplatesMutationError(error, 'reorder_followup_templates');
  return adaptFollowUpTemplateRows((data ?? []) as unknown as FollowUpTemplateRow[]);
}
