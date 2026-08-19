// lib/hooks/useTasksRemoteBridgeLifecycle.ts — único ponto de montagem da
// bridge de Tasks remotas (COMMERCIAL-REMOTE-B1-B2-B2-B). Ainda NÃO
// chamado por nenhum componente/App real (isso pertence ao B1-B3) —
// responsabilidade única deste hook é START/STOP do bridge
// (lib/tasks/taskBridge.ts), nunca query, adaptação ou TaskService.
//
// Estrutura espelha useLeadsRemoteBridgeLifecycle (mesmo input `currentUser:
// User | null`, mesma derivação de companyId/identityKey/role/active, mesma
// bridgeActive central, mesmo useEffect com cleanup-antes-de-novo-start) —
// mas com UMA divergência deliberada do precedente: o precedente de Leads
// nunca aceita `notify` (fica ausente por decisão daquela etapa, "nenhum
// consumidor fora do escopo autorizado foi conectado ainda"). Este hook
// aceita `notify?` como parâmetro explícito e o repassa ao bridge — B1-B3
// decide qual store/mecanismo de re-render legado usar, sem precisar
// alterar este hook para isso.
//
// Estabilidade de `notify` (precheck EXEC §22): o valor poderia ser uma
// arrow function recriada a cada render do chamador — incluí-lo apenas
// como está no array de dependências do efeito de start/stop causaria
// stop+start repetido a cada render, sem nenhuma mudança real de
// identidade/ownership. Solução: um ref guarda sempre o `notify` mais
// recente; o bridge recebe um wrapper ESTÁVEL (useCallback com array de
// dependências vazio) que apenas invoca `notifyRef.current`. O wrapper
// nunca muda de referência, então nunca força um restart do bridge só
// porque o caller passou uma nova função.
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@/lib/data';
import { startTaskRemoteBridge } from '@/lib/tasks/taskBridge';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';

export function useTasksRemoteBridgeLifecycle(
  currentUser: User | null,
  notify?: () => void,
): void {
  const queryClient = useQueryClient();

  // Ref sempre sincronizado com o `notify` mais recente — sem array de
  // dependências de propósito, roda em todo render (custo de uma
  // atribuição de ref, nunca dispara nada por si só).
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  });

  // Wrapper de referência ESTÁVEL para sempre — é isto, e não `notify`
  // diretamente, que entra no array de dependências do efeito abaixo.
  const stableNotify = useCallback(() => {
    notifyRef.current?.();
  }, []);

  const taskRemoteMode = resolveTaskRemoteMode();
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const identityKey = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  // Nunca para Super Admin (sem membershipRole, por design) — a condição
  // já exclui estruturalmente, sem checagem redundante de platformRole
  // aqui. `task_blocked` (rollout parcial esperado) e
  // `task_remote_misconfigured` (config inválida) resolvem para o mesmo
  // `false` aqui — a distinção entre os dois é responsabilidade da UI
  // (B1-B3), nunca deste hook: ele só liga/desliga o bridge.
  const bridgeActive =
    taskRemoteMode === 'task_remote_ready' &&
    isManagerOrSeller &&
    userIsActive &&
    Boolean(companyId) &&
    Boolean(identityKey);

  useEffect(() => {
    if (!bridgeActive || !companyId || !identityKey) return undefined;
    // Qualquer mudança de companyId/identityKey (troca de empresa, logout,
    // troca de usuário, transferência de membership) refaz este efeito:
    // cleanup do anterior roda ANTES do novo início (garantia do próprio
    // React), e o guard de geração do bridge (lib/tasks/taskBridge.ts)
    // descarta qualquer resposta tardia da identidade anterior mesmo que
    // cleanup e novo start colidam no mesmo tick.
    const stop = startTaskRemoteBridge({ queryClient, companyId, identityKey, notify: stableNotify });
    return stop;
  }, [queryClient, bridgeActive, companyId, identityKey, stableNotify]);
}
