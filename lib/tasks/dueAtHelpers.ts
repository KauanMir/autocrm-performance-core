// lib/tasks/dueAtHelpers.ts — conversão de data+hora local (já escolhidos
// pelo usuário) para o instante ISO 8601 que o backend espera em
// `due_at timestamptz` (COMMERCIAL-REMOTE-B1-B1).
//
// Decisão de produto congelada (B1-B1-EXEC §8): Hoje/Amanhã/Esta semana/
// Personalizado SEMPRE exigem hora escolhida pelo usuário — nunca 23:59
// automático, nunca interpretação de texto livre ("sexta-feira", "daqui 10
// dias"). Este módulo não conhece esses rótulos de UI (Hoje/Amanhã/Esta
// semana são responsabilidade de B1-B3) — recebe apenas uma data e uma
// hora já resolvidas e as combina.
//
// Timezone: usa exclusivamente o timezone local do browser/runtime (o
// construtor `new Date(year, month, day, hour, minute)` já interpreta os
// componentes como hora local) — nunca hardcoded para Brasília/UTC-3.
// Nenhuma biblioteca de data adicionada (date-fns/dayjs/luxon/moment não
// existem no projeto) — Date nativo é suficiente para este contrato.
//
// Puro, determinístico: sem Date.now() implícito, sem React, sem I/O.
import { startOfLocalDay } from '@/lib/tasks/deriveTaskState';

// 'YYYY-MM-DD' local (nunca via toISOString(), que converteria para UTC e
// poderia mostrar o dia errado perto da virada de meia-noite local).
// Extraído de components/flows/Flows2.tsx (era privado, já compartilhado
// ali por 3 consumidores — Tasks/Visits/reagendamento — antes desta
// extração) para o FOLLOW-UP-TEMPLATES-A3 poder reusar a MESMA noção de
// "dia local", nunca uma quarta reimplementação divergente. addLocalDays
// reusa startOfLocalDay (lib/tasks/deriveTaskState.ts) — mesmo conceito de
// "dia local" do resto do rollout, nunca uma segunda noção divergente.
export function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addLocalDays(d: Date, days: number): Date {
  const base = startOfLocalDay(d);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export interface LocalDateTimeInput {
  // 'YYYY-MM-DD' — mesmo formato de <input type="date">.
  date: string;
  // 'HH:mm', 24h — mesmo formato de <input type="time">.
  time: string;
}

export type LocalDateTimeInvalidReason = 'invalid_date' | 'invalid_time';

export type CombineLocalDateAndTimeResult =
  | { ok: true; iso: string }
  | { ok: false; reason: LocalDateTimeInvalidReason };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

// Combina uma data e uma hora locais (já escolhidas pelo usuário) num
// instante ISO 8601 válido para `timestamptz`. Rejeita deterministicamente
// — nunca deixa `Invalid Date` vazar como `.toISOString()` silencioso — e
// nunca aceita um dia que o JS "rolaria" para o mês seguinte (ex.: 31/02),
// detectado comparando os componentes de volta contra o Date construído.
export function combineLocalDateAndTimeToIso(
  input: LocalDateTimeInput,
): CombineLocalDateAndTimeResult {
  const dateMatch = DATE_PATTERN.exec(input.date ?? '');
  if (!dateMatch) return { ok: false, reason: 'invalid_date' };

  const timeMatch = TIME_PATTERN.exec(input.time ?? '');
  if (!timeMatch) return { ok: false, reason: 'invalid_time' };

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]); // 1-12, humano
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12) return { ok: false, reason: 'invalid_date' };
  if (day < 1 || day > 31) return { ok: false, reason: 'invalid_date' };
  if (hour < 0 || hour > 23) return { ok: false, reason: 'invalid_time' };
  if (minute < 0 || minute > 59) return { ok: false, reason: 'invalid_time' };

  // month - 1: Date usa índice de mês 0-11.
  const combined = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Detecta "rollover" (ex.: 31/02 vira 03/03 silenciosamente no Date
  // nativo) comparando os componentes de volta — se algum não bater
  // exatamente com o que foi pedido, a combinação era impossível.
  const rolledOver =
    combined.getFullYear() !== year ||
    combined.getMonth() !== month - 1 ||
    combined.getDate() !== day ||
    combined.getHours() !== hour ||
    combined.getMinutes() !== minute;
  if (rolledOver) return { ok: false, reason: 'invalid_date' };

  return { ok: true, iso: combined.toISOString() };
}
