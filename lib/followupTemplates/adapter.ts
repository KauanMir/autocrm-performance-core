// lib/followupTemplates/adapter.ts — row (snake_case, Database types) para
// model (camelCase) de Follow-up Templates (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Puro: sem React, sem Supabase, sem I/O.
import type { Database } from '@/lib/supabase/database.types';

export type FollowUpTemplateOffsetUnit = 'hour' | 'day';

export type FollowUpTemplateRow = Database['public']['Tables']['followup_templates']['Row'];

export type FollowUpTemplateModel = {
  id: string;
  companyId: string;
  name: string;
  taskTitle: string;
  taskNote: string;
  priority: Database['public']['Enums']['task_priority'];
  offsetValue: number;
  // offset_unit é `text` no banco (precheck A1 §7/A2-EXEC §3 — nunca um
  // enum novo); estreitado aqui para o único par válido — qualquer outro
  // valor (nunca deveria acontecer, a RPC valida) cai em 'day' como fallback
  // seguro de exibição, nunca 'hour' (que muda a semântica de default_time).
  offsetUnit: FollowUpTemplateOffsetUnit;
  defaultTime: string | null;
  isActive: boolean;
  sortOrder: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

function normalizeOffsetUnit(value: string): FollowUpTemplateOffsetUnit {
  return value === 'hour' ? 'hour' : 'day';
}

export function adaptFollowUpTemplateRow(row: FollowUpTemplateRow): FollowUpTemplateModel {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    taskTitle: row.task_title,
    taskNote: row.task_note,
    priority: row.priority,
    offsetValue: row.offset_value,
    offsetUnit: normalizeOffsetUnit(row.offset_unit),
    defaultTime: row.default_time,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function adaptFollowUpTemplateRows(rows: readonly FollowUpTemplateRow[]): FollowUpTemplateModel[] {
  return rows.map(adaptFollowUpTemplateRow);
}
