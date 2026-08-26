// lib/followupTemplates/labels.ts — rótulos PT-BR fixos de Follow-up
// Templates (FOLLOW-UP-TEMPLATES-A3-EXEC). Puro, sem React.
import type { Database } from '@/lib/supabase/database.types';
import type { FollowUpTemplateOffsetUnit } from '@/lib/followupTemplates/adapter';

type TaskPriority = Database['public']['Enums']['task_priority'];

export const FOLLOWUP_PRIORITY_LABEL: Record<TaskPriority, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const FOLLOWUP_PRIORITY_OPTIONS: [TaskPriority, string][] = [
  ['alta', 'Alta'],
  ['media', 'Média'],
  ['baixa', 'Baixa'],
];

// Rótulo da unidade no seletor de configuração ("Retornar em [2] [Dias]") —
// singular/plural conforme o valor atual (precheck A3-EXEC §10).
export function formatOffsetUnitOptionLabel(unit: FollowUpTemplateOffsetUnit, value: number): string {
  if (unit === 'hour') return value === 1 ? 'Hora' : 'Horas';
  return value === 1 ? 'Dia' : 'Dias';
}
