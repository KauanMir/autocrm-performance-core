// lib/leads/remoteLeadsMode.ts — modo efetivo de Leads remotos (M1-E, E3-B1).
// Puro: sem React, sem estado, sem consulta a .env em outros módulos — SÓ
// helper central que combina as duas flags reais (nunca as altera). Decisão
// humana: REMOTE_LEADS=true exige REMOTE_STAGES=true — sem etapas remotas
// compatíveis, o caminho remoto de Leads falha fechado (nunca mistura Leads
// remotos com Stages locais, nunca inventa nome de etapa).
import { isRemoteLeadsEnabled, isRemoteStagesEnabled } from '@/lib/flags';

export type RemoteLeadsFlagMode =
  // REMOTE_LEADS=false — caminho local, inalterado.
  | 'local'
  // REMOTE_LEADS=true e REMOTE_STAGES=true — caminho remoto pode ser efetivo
  // (a identidade do ator ainda decide se de fato monta).
  | 'remote_ready'
  // REMOTE_LEADS=true e REMOTE_STAGES=false — combinação insegura: nenhuma
  // bridge, nenhum dado local, nenhum dado remoto — estado de configuração
  // indisponível.
  | 'remote_misconfigured';

export function resolveRemoteLeadsFlagMode(): RemoteLeadsFlagMode {
  if (!isRemoteLeadsEnabled()) return 'local';
  return isRemoteStagesEnabled() ? 'remote_ready' : 'remote_misconfigured';
}
