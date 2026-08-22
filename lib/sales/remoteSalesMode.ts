// lib/sales/remoteSalesMode.ts — modo efetivo de Sales remotas
// (COMMERCIAL-REMOTE-SALES-A2). Puro: sem React, sem estado, sem consulta a
// .env em outros módulos — só helper central que combina a flag própria de
// Sales com o modo já resolvido de Deals (nunca as altera). Mesmo contrato
// exato de lib/deals/remoteDealsMode.ts/lib/visits/remoteVisitsMode.ts/
// lib/tasks/remoteTasksMode.ts — só o prefixo de nomenclatura muda
// (sale_ em vez de deal_/visit_/task_).
//
// Sales depende de REMOTE_DEALS estar deal_remote_ready — NUNCA de
// REMOTE_LEADS/REMOTE_STAGES/REMOTE_VISITS/REMOTE_TASKS diretamente: toda
// Sale remota nasce OBRIGATORIAMENTE de uma Deal remota já aberta
// (register_sale exige um deal_id existente, migration #54) — a mesma
// razão estrutural pela qual Deals depende de Leads (lead_id NOT NULL),
// SALES-A1-PRECHECK §4/§6.
import { isRemoteSalesEnabled } from '@/lib/flags';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';

export type SaleRemoteMode =
  // REMOTE_SALES=false e Deals também está local — caminho local de
  // sempre, inalterado (SaleService/localStorage).
  | 'sale_local'
  // REMOTE_SALES=false, mas Deals já está deal_remote_ready — Sales não
  // pode continuar em localStorage ao lado de Deals remoto (dado comercial
  // preso ao navegador), mas REMOTE_SALES ainda não foi ligada para
  // liberar o caminho remoto. Rollout parcial ESPERADO, nunca tratado como
  // erro — Sales simplesmente fica indisponível (nem local, nem remoto)
  // até a flag própria ser ativada.
  | 'sale_blocked'
  // REMOTE_SALES=true e Deals está deal_remote_ready — caminho remoto pode
  // ser efetivo (a identidade do ator ainda decide se de fato monta).
  | 'sale_remote_ready'
  // Configuração de base realmente inválida: ou (a) REMOTE_SALES=true mas
  // Deals não está deal_remote_ready (Sales pediu remoto sem a dependência
  // pronta), ou (b) o modo de Deals em si já é deal_remote_misconfigured —
  // nesse segundo caso a invalidez de Deals é PROPAGADA para Sales
  // independentemente do valor de REMOTE_SALES.
  | 'sale_remote_misconfigured';

export function resolveSalesRemoteMode(): SaleRemoteMode {
  const dealsMode = resolveDealRemoteMode();
  const salesEnabled = isRemoteSalesEnabled();

  if (dealsMode === 'deal_remote_misconfigured') return 'sale_remote_misconfigured';

  if (!salesEnabled) {
    return dealsMode === 'deal_local' ? 'sale_local' : 'sale_blocked';
  }

  return dealsMode === 'deal_remote_ready' ? 'sale_remote_ready' : 'sale_remote_misconfigured';
}
