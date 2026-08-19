// lib/hooks/useRemoteTasksScreenState.ts — composição de leitura remota de
// Tasks (COMMERCIAL-REMOTE-B1-B2-B3-B). Único ponto que combina useTasks +
// useAdaptedRemoteTasks + useRemoteLeadsScreenState com a MESMA identidade
// e o MESMO contrato de flags — futuros consumidores (TaskService/Home/
// ScreenPendencias, fora do escopo desta etapa) chamarão este hook, nunca
// os três hooks separadamente.
//
// Identidade vem por parâmetro (currentUser) — mesmo padrão de useTasks/
// useTasksRemoteBridgeLifecycle/useRemoteLeadsScreenState: este hook não
// importa AuthService. A fórmula de identidade válida (userId + companyId
// + userIsActive + role manager/seller) é EXATAMENTE a mesma usada pelos
// dois outros pontos de gating de Tasks (query e bridge) — auditada linha
// a linha nesta etapa, não reinventada — para nunca divergir de quando a
// query real está habilitada ou o bridge real está ativo (§16).
//
// Rules of Hooks: os três hooks internos são SEMPRE chamados, na mesma
// ordem — useTasks já resolve seu próprio `queryEnabled` internamente
// (nenhuma chamada condicional aqui); useAdaptedRemoteTasks recebe rows
// vazias fora do caminho ativo (hard gate na FONTE, §23), nunca um hook
// pulado.
//
// HARD GATE (§0/§19): TanStack Query pode continuar expondo dado
// cacheado mesmo com `enabled=false` ou após um erro — por isso o mode
// final decide sozinho se alguma Task é exposta, nunca o cache por si só.
// Fora de `task_remote_active`, ou dentro dele durante loading/erro
// inicial, `rowsForAdaptation` é sempre `[]`: nenhuma Task cacheada de um
// estado ativo anterior pode vazar para local/blocked/misconfigured/
// unavailable-identity/loading/erro.
import { useMemo } from 'react';
import type { User } from '@/lib/data';
import { useTasks } from '@/lib/hooks/useTasks';
import { useAdaptedRemoteTasks } from '@/lib/hooks/useAdaptedRemoteTasks';
import { useRemoteLeadsScreenState } from '@/lib/hooks/useRemoteLeadsScreenState';
import {
  isTaskAdapterError,
  type RemoteTaskModel,
  type RemoteTaskRow,
  type TaskAdapterError,
  type TaskLeadRef,
} from '@/lib/tasks/taskAdapter';

export type TaskScreenMode =
  // task_remote_ready=false e Leads também local — caminho local existente
  // (TaskService/localStorage), este hook não decide mais nada.
  | 'task_local'
  // Rollout parcial esperado: Leads já remote_ready, REMOTE_TASKS ainda
  // off — nunca tratado como erro (lib/tasks/remoteTasksMode.ts).
  | 'task_blocked'
  // Config de base inválida (própria ou propagada de Leads) — falha
  // fechada, nenhuma bridge, nenhum dado local nem remoto.
  | 'task_remote_misconfigured'
  // task_remote_ready, mas o ator atual não qualifica (sem membership
  // ativa/operacional, não é Manager/Seller, ou usuário global inativo).
  | 'task_remote_unavailable_identity'
  // Caminho remoto efetivo: useTasks/useAdaptedRemoteTasks são a
  // autoridade de loading/error/config-error/empty/success.
  | 'task_remote_active';

export type UseRemoteTasksScreenStateResult = {
  mode: TaskScreenMode;
  tasks: readonly RemoteTaskModel[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: TaskAdapterError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const EMPTY_ROWS: readonly RemoteTaskRow[] = Object.freeze([]);
const EMPTY_TASKS: readonly RemoteTaskModel[] = Object.freeze([]);

export function useRemoteTasksScreenState(
  currentUser: User | null,
): UseRemoteTasksScreenStateResult {
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
  const hasIdentity =
    isManagerOrSeller && userIsActive && Boolean(companyId) && Boolean(userId);

  // Chamados SEMPRE, na mesma ordem (Rules of Hooks). taskRemoteMode vem
  // do PRÓPRIO retorno de useTasks (nunca recalculado por uma segunda
  // chamada a resolveTaskRemoteMode aqui) — garante, por construção, que
  // o mode usado para decidir loading/error/gate é o MESMO valor que
  // decidiu `queryEnabled` dentro de useTasks (§16, nenhuma divergência).
  const tasksQuery = useTasks({ userId, companyId, membershipRole, userIsActive });

  // Fonte reativa de Leads (§11) — nunca lê o snapshot singleton durante
  // render React; usa o mesmo composer já usado pelas telas de Leads.
  const leadsScreenState = useRemoteLeadsScreenState(currentUser);

  const leadsById = useMemo(() => {
    const map: Record<string, TaskLeadRef> = {};
    for (const lead of leadsScreenState.leads.leads) {
      map[lead.id] = { id: lead.id, name: lead.name };
    }
    return map;
  }, [leadsScreenState.leads.leads]);

  let mode: TaskScreenMode;
  if (tasksQuery.taskRemoteMode === 'task_local') mode = 'task_local';
  else if (tasksQuery.taskRemoteMode === 'task_blocked') mode = 'task_blocked';
  else if (tasksQuery.taskRemoteMode === 'task_remote_misconfigured') mode = 'task_remote_misconfigured';
  else if (!hasIdentity) mode = 'task_remote_unavailable_identity';
  else mode = 'task_remote_active';

  const isActive = mode === 'task_remote_active';
  const activeLoading = isActive && tasksQuery.isLoading;
  const activeError = isActive && tasksQuery.isError;

  // Hard gate NA FONTE (§23, exemplo do próprio precheck): fora do
  // caminho realmente pronto para adaptar (active + não-loading + não-
  // erro), o adapter nunca vê uma row cacheada — sempre []. Hook ainda
  // chamado sempre (Rules of Hooks), só o INPUT muda.
  const rowsForAdaptation = isActive && !activeLoading && !activeError ? tasksQuery.rows : EMPTY_ROWS;
  const adapted = useAdaptedRemoteTasks(rowsForAdaptation, leadsById);

  let tasks: readonly RemoteTaskModel[] = EMPTY_TASKS;
  let configError: TaskAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isTaskAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.tasks.length === 0) {
      isEmpty = true;
    } else {
      tasks = adapted.tasks;
      hasData = true;
    }
  }

  return {
    mode,
    tasks,
    isLoading: activeLoading,
    isFetching: isActive ? tasksQuery.isFetching : false,
    isError: activeError,
    error: activeError ? tasksQuery.error : null,
    configError,
    isEmpty,
    hasData,
    refetch: tasksQuery.refetch,
  };
}
