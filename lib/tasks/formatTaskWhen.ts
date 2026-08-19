// lib/tasks/formatTaskWhen.ts — formata um `due_at` em texto de exibição
// ("Hoje, 14:00", "Venceu ontem, 16:00", "Sex, 21/08, 15:30")
// (COMMERCIAL-REMOTE-B1-B1).
//
// Deliberadamente SEPARADO de deriveTaskState (lib/tasks/deriveTaskState.ts,
// precheck §14/§20): um decide agrupamento (LATE/TODAY/UPCOMING), o outro só
// produz o texto — nunca a mesma função fazendo as duas coisas. Reaproveita
// startOfLocalDay de deriveTaskState.ts (mesmo conceito de "dia local",
// nunca duas implementações divergentes).
//
// Sem biblioteca de data (nenhuma existe no projeto) — Date nativo,
// PT-BR fixo (mesmo padrão dos poucos formatters já existentes no
// projeto, ex.: lib/leads/adapter.ts formatValueAmount). Sem
// internacionalização nesta etapa, de propósito.
import { startOfLocalDay } from '@/lib/tasks/deriveTaskState';

const WEEKDAY_ABBR_PT_BR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatShortDate(d: Date): string {
  return `${WEEKDAY_ABBR_PT_BR[d.getDay()]}, ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function formatTaskWhen(dueAt: Date, now: Date = new Date()): string {
  const time = formatTime(dueAt);
  const dueDay = startOfLocalDay(dueAt).getTime();
  const today = startOfLocalDay(now).getTime();
  // Round: os dois já são meia-noite local, a divisão é sempre um inteiro
  // exato — round só protege contra ruído de ponto flutuante residual.
  const diffDays = Math.round((dueDay - today) / MS_PER_DAY);

  if (diffDays === 0) return `Hoje, ${time}`;
  if (diffDays === 1) return `Amanhã, ${time}`;
  if (diffDays === -1) return `Venceu ontem, ${time}`;
  if (diffDays < -1) return `Venceu há ${Math.abs(diffDays)} dias, ${time}`;
  return `${formatShortDate(dueAt)}, ${time}`;
}
