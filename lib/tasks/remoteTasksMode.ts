// lib/tasks/remoteTasksMode.ts — modo efetivo de Tasks remotas
// (COMMERCIAL-REMOTE-B1-B1). Puro: sem React, sem estado, sem consulta a
// .env em outros módulos — só helper central que combina a flag própria de
// Tasks com o modo já resolvido de Leads (nunca as altera).
//
// CORREÇÃO OBRIGATÓRIA (B1-B1-EXEC §0, decisão humana): o precheck original
// reduzia isto a 3 estados (local/remote_ready/remote_misconfigured), o que
// apagava a diferença entre "config inválida" e "rollout parcial esperado".
// Congelado agora: Tasks NUNCA pode ficar em localStorage enquanto Leads já
// está remoto (isso prenderia dado comercial real ao navegador) — por isso
// existe um 4º estado, 'task_blocked', para exatamente esse caso (Leads já
// remote_ready, mas REMOTE_TASKS ainda não foi ligada — rollout parcial
// normal, não é erro de configuração).
//
// Nomenclatura prefixada com `task_` de propósito — evita colidir/confundir
// com os literais 'local'/'remote_ready'/'remote_misconfigured' de
// RemoteLeadsFlagMode (lib/leads/remoteLeadsMode.ts), que são um tipo
// estruturalmente diferente mesmo compartilhando alguns nomes.
import { isRemoteTasksEnabled } from '@/lib/flags';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export type TaskRemoteMode =
  // REMOTE_TASKS=false e Leads também está local — caminho local de sempre,
  // inalterado (TaskService/localStorage).
  | 'task_local'
  // REMOTE_TASKS=false, mas Leads já está remote_ready — Tasks não pode
  // continuar em localStorage ao lado de Leads remoto (dado comercial preso
  // ao navegador), mas REMOTE_TASKS ainda não foi ligada para liberar o
  // caminho remoto. Rollout parcial ESPERADO, nunca tratado como erro —
  // Tasks simplesmente fica indisponível (nem local, nem remoto) até a
  // flag própria ser ativada.
  | 'task_blocked'
  // REMOTE_TASKS=true e Leads está remote_ready — caminho remoto efetivo
  // (a identidade do ator ainda decide se de fato monta, como em Leads).
  | 'task_remote_ready'
  // Configuração de base realmente inválida: ou (a) REMOTE_TASKS=true mas
  // Leads não está remote_ready (Tasks pediu remoto sem a dependência
  // pronta), ou (b) o modo de Leads em si já é remote_misconfigured
  // (REMOTE_LEADS=true + REMOTE_STAGES=false) — nesse segundo caso a
  // invalidez de Leads é PROPAGADA para Tasks independentemente do valor
  // de REMOTE_TASKS: uma configuração de base quebrada nunca produz uma
  // segunda interpretação (blocked) contraditória com a primeira
  // (misconfigured) só porque Tasks está OFF.
  | 'task_remote_misconfigured';

export function resolveTaskRemoteMode(): TaskRemoteMode {
  const leadsMode = resolveRemoteLeadsFlagMode();
  const tasksEnabled = isRemoteTasksEnabled();

  // Leads já está numa configuração de base inválida — propaga, nunca
  // reinterpreta como "rollout parcial" nem como "local" (regra central do
  // §0: nenhuma segunda interpretação contraditória de uma config quebrada).
  if (leadsMode === 'remote_misconfigured') return 'task_remote_misconfigured';

  if (!tasksEnabled) {
    // REMOTE_TASKS=false: só é seguro ficar local se Leads TAMBÉM está
    // local. Leads remote_ready + Tasks ainda OFF é o rollout parcial
    // esperado (nunca volta a escrever em localStorage ao lado de Leads
    // remoto).
    return leadsMode === 'local' ? 'task_local' : 'task_blocked';
  }

  // REMOTE_TASKS=true: só é efetivo quando Leads já está remote_ready:
  // Tasks depende estruturalmente do snapshot/bridge de Leads (nomes de
  // Lead resolvidos sem N+1, ver B1-B precheck §4) e do mesmo modelo de
  // tenancy — pedir Tasks remoto sem essa base pronta é config inválida,
  // nunca um fallback silencioso para local.
  return leadsMode === 'remote_ready' ? 'task_remote_ready' : 'task_remote_misconfigured';
}
