// lib/visits/remoteVisitsMode.ts — modo efetivo de Visits remotas
// (COMMERCIAL-REMOTE-VISITS-B2). Puro: sem React, sem estado, sem consulta
// a .env em outros módulos — só helper central que combina a flag própria
// de Visits com o modo já resolvido de Leads (nunca as altera). Mesmo
// contrato exato de lib/tasks/remoteTasksMode.ts (TaskRemoteMode) — só o
// prefixo de nomenclatura muda (visit_ em vez de task_), evitando colidir/
// confundir com os literais 'local'/'remote_ready'/'remote_misconfigured'
// de RemoteLeadsFlagMode.
//
// Visits depende de REMOTE_LEADS estar remote_ready — NUNCA de
// REMOTE_STAGES nem de REMOTE_TASKS: os quatro domínios comerciais
// (Tasks/Visits/Deals/Sales) são independentes entre si, cada um só
// depende da base de Leads já remota (VISITS-AUDIT §33/B2-PRECHECK §5).
import { isRemoteVisitsEnabled } from '@/lib/flags';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export type VisitRemoteMode =
  // REMOTE_VISITS=false e Leads também está local — caminho local de
  // sempre, inalterado (VisitService/localStorage).
  | 'visit_local'
  // REMOTE_VISITS=false, mas Leads já está remote_ready — Visits não pode
  // continuar em localStorage ao lado de Leads remoto (dado comercial
  // preso ao navegador), mas REMOTE_VISITS ainda não foi ligada para
  // liberar o caminho remoto. Rollout parcial ESPERADO, nunca tratado como
  // erro — Visits simplesmente fica indisponível (nem local, nem remoto)
  // até a flag própria ser ativada.
  | 'visit_blocked'
  // REMOTE_VISITS=true e Leads está remote_ready — caminho remoto pode ser
  // efetivo (a identidade do ator ainda decide se de fato monta).
  | 'visit_remote_ready'
  // Configuração de base realmente inválida: ou (a) REMOTE_VISITS=true mas
  // Leads não está remote_ready (Visits pediu remoto sem a dependência
  // pronta), ou (b) o modo de Leads em si já é remote_misconfigured
  // (REMOTE_LEADS=true + REMOTE_STAGES=false) — nesse segundo caso a
  // invalidez de Leads é PROPAGADA para Visits independentemente do valor
  // de REMOTE_VISITS: uma configuração de base quebrada nunca produz uma
  // segunda interpretação (blocked) contraditória com a primeira
  // (misconfigured) só porque Visits está OFF.
  | 'visit_remote_misconfigured';

export function resolveVisitRemoteMode(): VisitRemoteMode {
  const leadsMode = resolveRemoteLeadsFlagMode();
  const visitsEnabled = isRemoteVisitsEnabled();

  if (leadsMode === 'remote_misconfigured') return 'visit_remote_misconfigured';

  if (!visitsEnabled) {
    return leadsMode === 'local' ? 'visit_local' : 'visit_blocked';
  }

  return leadsMode === 'remote_ready' ? 'visit_remote_ready' : 'visit_remote_misconfigured';
}
