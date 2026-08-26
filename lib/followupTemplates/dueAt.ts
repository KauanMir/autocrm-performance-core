// lib/followupTemplates/dueAt.ts — cálculo de due_at a partir de um
// Follow-up Template (FOLLOW-UP-TEMPLATES-A3-EXEC). Reusa EXATAMENTE os
// mesmos helpers já usados por FlowNovaPendencia/FlowReagendarPendencia
// (localYMD/addLocalDays/combineLocalDateAndTimeToIso, lib/tasks/
// dueAtHelpers.ts) — nenhuma segunda noção de "dia local"/"hora válida"
// divergente (precheck A3-EXEC §32/§33/§37). Cálculo SEMPRE no cliente
// (nunca no servidor — create_task recebe due_at pronto, exatamente como já
// faz hoje) e SEMPRE via calendário/relógio LOCAL do browser — nunca
// companies.timezone (não usado em NENHUM ponto do produto para due_at
// hoje, introduzi-lo só aqui criaria dois modelos de tempo divergentes).
//
// offset_unit='hour': instante real (now + N horas) — nunca dia civil.
// offset_unit='day': dia civil local (hoje + N dias) — nunca N*24h em ms
// (isso quebraria em mudança de horário de verão). Horário: default_time do
// template quando presente; senão o horário escolhido pelo usuário na
// confirmação (nunca inventado — precheck A3-EXEC §35, mesma regra
// congelada de dueAtHelpers.ts: "nunca 23:59 automático").
//
// Puro, determinístico: `now` sempre injetável.
import { combineLocalDateAndTimeToIso, localYMD, addLocalDays } from '@/lib/tasks/dueAtHelpers';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

export type FollowUpTemplateDueAtInput = Pick<FollowUpTemplateModel, 'offsetUnit' | 'offsetValue' | 'defaultTime'>;

export type FollowUpTemplateDueAtResult =
  | { ok: true; iso: string; previewDateYMD: string; previewTime: string }
  | { ok: false; reason: 'time_required' | 'invalid_time' };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function resolveFollowUpTemplateDueAt(
  template: FollowUpTemplateDueAtInput,
  chosenTime: string,
  now: Date = new Date(),
): FollowUpTemplateDueAtResult {
  if (template.offsetUnit === 'hour') {
    const dueAt = new Date(now.getTime() + template.offsetValue * 60 * 60 * 1000);
    return {
      ok: true,
      iso: dueAt.toISOString(),
      previewDateYMD: localYMD(dueAt),
      previewTime: `${pad2(dueAt.getHours())}:${pad2(dueAt.getMinutes())}`,
    };
  }

  const targetDateYMD = localYMD(addLocalDays(now, template.offsetValue));
  const time = template.defaultTime ?? (chosenTime.trim() !== '' ? chosenTime : '');
  if (time === '') return { ok: false, reason: 'time_required' };

  const combined = combineLocalDateAndTimeToIso({ date: targetDateYMD, time });
  if (!combined.ok) return { ok: false, reason: 'invalid_time' };

  return { ok: true, iso: combined.iso, previewDateYMD: targetDateYMD, previewTime: time };
}

// Texto humano da data/hora calculada, para a tela de confirmação (precheck
// A3-EXEC §25/§34/§36) — "Hoje às 14:30" / "Amanhã às 09:00" / "26/08/2026
// às 09:00". Sem em dash (copy §45) — sempre um texto positivo.
export function formatFollowUpDueAtPreview(previewDateYMD: string, previewTime: string, now: Date = new Date()): string {
  const todayYMD = localYMD(now);
  const tomorrowYMD = localYMD(addLocalDays(now, 1));
  if (previewDateYMD === todayYMD) return `Hoje às ${previewTime}`;
  if (previewDateYMD === tomorrowYMD) return `Amanhã às ${previewTime}`;
  const [year, month, day] = previewDateYMD.split('-');
  return `${day}/${month}/${year} às ${previewTime}`;
}
