// lib/tasks/deriveTaskState.ts — deriva o TASK_STATE de exibição
// (LATE/TODAY/UPCOMING/DONE) a partir do status remoto persistido
// (pending/completed) + due_at, nunca o contrário (COMMERCIAL-REMOTE-B1-B1).
//
// Ganho funcional novo (não é port de comportamento existente): o produto
// local nunca recalculava overdue a partir do relógio — `state` era uma
// string gravada uma vez na criação e nunca revista. Aqui, LATE/TODAY/
// UPCOMING são sempre recomputados a partir do dia local atual, então uma
// Task "esquecida" vira LATE sozinha, sem nenhuma ação do usuário.
//
// Semântica congelada (B1-B1-EXEC §11/§12): comparação por DIA local, nunca
// por instante/hora — uma Task de hoje às 17:00, vista às 15:00, continua
// TODAY (não é `due_at < now`). Ela só vira LATE quando o DIA civil muda
// (virada de meia-noite local), nunca por causa do horário dentro do
// próprio dia. "Esta semana" é só rótulo de INPUT (B1-B3) — não existe
// aqui, de propósito (§14 do precheck): misturaria UX de criação com
// modelo de estado.
//
// Puro, determinístico: `now` é sempre injetável (default `new Date()`
// somente para uso em runtime real) — testes nunca dependem do relógio da
// máquina.
import { TASK_STATE, type TaskState } from '@/lib/data';

export type RemoteTaskStatus = 'pending' | 'completed';

// Início do dia civil LOCAL (00:00, timezone do browser/runtime) — nunca
// UTC, nunca meio-dia, nunca epoch bruto. Exportado para reuso pelo
// formatter (lib/tasks/formatTaskWhen.ts) — mesma regra de "o que é hoje",
// nunca duas implementações divergentes do mesmo conceito.
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function deriveTaskState(
  status: RemoteTaskStatus,
  dueAt: Date,
  now: Date = new Date(),
): TaskState {
  if (status === 'completed') return TASK_STATE.DONE;

  const dueDay = startOfLocalDay(dueAt).getTime();
  const today = startOfLocalDay(now).getTime();

  if (dueDay < today) return TASK_STATE.LATE;
  if (dueDay === today) return TASK_STATE.TODAY;
  return TASK_STATE.UPCOMING;
}
