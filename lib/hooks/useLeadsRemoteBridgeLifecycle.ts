// lib/hooks/useLeadsRemoteBridgeLifecycle.ts — único ponto de montagem da
// bridge de Leads remotos (M1-E, E3-B1). Chamado UMA vez, próximo ao ciclo
// de identidade do App (mesmo nível de useQueryCacheIdentity) — nunca dentro
// de ScreenClientesLegacy/ScreenAndamentoLegacy, para que o espelho
// (lib/leads/remoteSnapshot.ts) sirva LeadService.getAll()/getById() de
// forma consistente para QUALQUER tela, não só as duas conectadas nesta
// etapa (ex.: Flows abertos a partir de um card já lido).
//
// Único proprietário lógico do ciclo remoto: nenhuma outra chamada a
// startLeadsRemoteBridge existe no projeto. `notify` fica deliberadamente
// ausente (undefined) — nenhum consumidor fora do escopo autorizado desta
// etapa (Pendências, Flows) foi conectado a re-render reativo via
// useStore(); a bridge continua funcionalmente completa sem ele (o efeito
// prático só aparece quando REMOTE_LEADS estiver ativada, o que esta etapa
// não faz).
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@/lib/data';
import { startLeadsRemoteBridge } from '@/lib/leads/bridge';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export function useLeadsRemoteBridgeLifecycle(currentUser: User | null): void {
  const queryClient = useQueryClient();

  const flagMode = resolveRemoteLeadsFlagMode();
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const identityKey = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  // Nunca para Super Admin (sem membershipRole, por design) — a condição já
  // exclui estruturalmente, sem checagem redundante de platformRole aqui.
  const bridgeActive =
    flagMode === 'remote_ready' &&
    isManagerOrSeller &&
    userIsActive &&
    Boolean(companyId) &&
    Boolean(identityKey);

  useEffect(() => {
    if (!bridgeActive || !companyId || !identityKey) return undefined;
    // Qualquer mudança de companyId/identityKey (troca de empresa, logout,
    // troca de usuário, transferência de membership) refaz este efeito:
    // cleanup do anterior roda ANTES do novo início, e o guard de geração
    // do próprio bridge.ts descarta qualquer resposta tardia da identidade
    // anterior mesmo que o cleanup e o novo start colidam no mesmo tick.
    const stop = startLeadsRemoteBridge({ queryClient, companyId, identityKey });
    return stop;
  }, [queryClient, bridgeActive, companyId, identityKey]);
}
