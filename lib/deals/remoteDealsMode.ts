// lib/deals/remoteDealsMode.ts — modo efetivo de Deals remotas
// (COMMERCIAL-REMOTE-DEALS-B2-A). Puro: sem React, sem estado, sem consulta
// a .env em outros módulos — só helper central que combina a flag própria
// de Deals com o modo já resolvido de Leads (nunca as altera). Mesmo
// contrato exato de lib/visits/remoteVisitsMode.ts/lib/tasks/remoteTasksMode.ts
// — só o prefixo de nomenclatura muda (deal_ em vez de visit_/task_).
//
// Deals depende de REMOTE_LEADS estar remote_ready — NUNCA de
// REMOTE_STAGES nem de REMOTE_VISITS/REMOTE_TASKS: os quatro domínios
// comerciais (Tasks/Visits/Deals/Sales) são independentes entre si, cada um
// só depende da base de Leads já remota (B1-PRECHECK §28,
// B2-A-PRECHECK §14, motivo: toda Deal exige lead_id NOT NULL). Visits é um
// futuro entry point (outcome negotiating), não uma dependência estrutural.
import { isRemoteDealsEnabled } from '@/lib/flags';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export type DealRemoteMode =
  // REMOTE_DEALS=false e Leads também está local — caminho local de
  // sempre, inalterado (DealService/localStorage).
  | 'deal_local'
  // REMOTE_DEALS=false, mas Leads já está remote_ready — Deals não pode
  // continuar em localStorage ao lado de Leads remoto (dado comercial
  // preso ao navegador), mas REMOTE_DEALS ainda não foi ligada para liberar
  // o caminho remoto. Rollout parcial ESPERADO, nunca tratado como erro —
  // Deals simplesmente fica indisponível (nem local, nem remoto) até a
  // flag própria ser ativada.
  | 'deal_blocked'
  // REMOTE_DEALS=true e Leads está remote_ready — caminho remoto pode ser
  // efetivo (a identidade do ator ainda decide se de fato monta).
  | 'deal_remote_ready'
  // Configuração de base realmente inválida: ou (a) REMOTE_DEALS=true mas
  // Leads não está remote_ready (Deals pediu remoto sem a dependência
  // pronta), ou (b) o modo de Leads em si já é remote_misconfigured — nesse
  // segundo caso a invalidez de Leads é PROPAGADA para Deals
  // independentemente do valor de REMOTE_DEALS: uma configuração de base
  // quebrada nunca produz uma segunda interpretação (blocked) contraditória
  // com a primeira (misconfigured) só porque Deals está OFF.
  | 'deal_remote_misconfigured';

export function resolveDealRemoteMode(): DealRemoteMode {
  const leadsMode = resolveRemoteLeadsFlagMode();
  const dealsEnabled = isRemoteDealsEnabled();

  if (leadsMode === 'remote_misconfigured') return 'deal_remote_misconfigured';

  if (!dealsEnabled) {
    return leadsMode === 'local' ? 'deal_local' : 'deal_blocked';
  }

  return leadsMode === 'remote_ready' ? 'deal_remote_ready' : 'deal_remote_misconfigured';
}
