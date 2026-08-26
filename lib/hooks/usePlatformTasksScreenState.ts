// lib/hooks/usePlatformTasksScreenState.ts —
// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC. Composição de leitura
// company-wide de Tasks para o Super Admin contextual (/company/[id]) —
// bridge EXCLUSIVO, nunca usado por Manager/Seller (useRemoteTasksScreenState
// continua sendo a fonte deles, intocada por este arquivo, §11/§12 do
// EXEC). Mesmo shape de saída de UseRemoteTasksScreenStateResult
// (mode/tasks/isLoading/...) para que ScreenPendencias reaproveite a
// MESMA árvore de renderização sem reescrita (§16 do PRECHECK).
//
// leadsById vem de usePlatformLeads (M1-F S8-C2-B2, já existente) — nunca
// de useRemoteLeadsScreenState (membership-only) — mesmo companyId
// explícito, nenhuma segunda resolução de autorização de Leads.
//
// Adaptação reaproveita useAdaptedRemoteTasks (puro, sem dependência de
// membership) — zero duplicação de lib/tasks/deriveRemoteTasks.ts.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPlatformTaskRows } from '@/lib/tasks/remoteTaskRepository';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { usePlatformLeads } from '@/lib/hooks/usePlatformLeads';
import { useAdaptedRemoteTasks } from '@/lib/hooks/useAdaptedRemoteTasks';
import {
  isTaskAdapterError,
  type RemoteTaskModel,
  type RemoteTaskRow,
  type TaskAdapterError,
  type TaskLeadRef,
} from '@/lib/tasks/taskAdapter';
import type { UseRemoteTasksScreenStateResult } from '@/lib/hooks/useRemoteTasksScreenState';

const DISABLED_QUERY_KEY = ['company', null, 'tasks', 'platform', 'disabled'] as const;
const EMPTY_ROWS: readonly RemoteTaskRow[] = Object.freeze([]);
const EMPTY_TASKS: readonly RemoteTaskModel[] = Object.freeze([]);

export function usePlatformTasksScreenState(companyId: string | null): UseRemoteTasksScreenStateResult {
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const query = useQuery<RemoteTaskRow[]>({
    queryKey: hasCompany ? taskQueryKeys.platform(companyId as string) : DISABLED_QUERY_KEY,
    enabled: hasCompany,
    queryFn: () => fetchPlatformTaskRows(companyId as string),
  });

  // Mesmo companyId explícito do contexto operacional — nunca uma segunda
  // seleção de empresa (§15 do EXEC-V1, "não criar duas autoridades").
  const leadsQuery = usePlatformLeads({ companyId, archived: false, authorized: hasCompany });
  const leadsById = useMemo(() => {
    const map: Record<string, TaskLeadRef> = {};
    for (const lead of leadsQuery.leads) {
      map[lead.id] = { id: lead.id, name: lead.name };
    }
    return map;
  }, [leadsQuery.leads]);

  // 'task_remote_unavailable_identity' reaproveitado de propósito (mesmo
  // union já consumido por ScreenPendencias) para "ainda não pronto" —
  // nunca um novo valor de mode que exigiria reescrever o branching da
  // tela (§16 do PRECHECK).
  const isActive = hasCompany;
  const activeLoading = isActive && (query.isLoading || leadsQuery.isLoading);
  const activeError = isActive && (query.isError || leadsQuery.isError);

  const rowsForAdaptation = isActive && !activeLoading && !activeError ? (query.data ?? EMPTY_ROWS) : EMPTY_ROWS;
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
    mode: isActive ? 'task_remote_active' : 'task_remote_unavailable_identity',
    tasks,
    isLoading: activeLoading,
    isFetching: isActive ? (query.isFetching || leadsQuery.isFetching) : false,
    isError: activeError,
    error: activeError ? (query.error ?? leadsQuery.error) : null,
    configError,
    isEmpty,
    hasData,
    refetch: () => { query.refetch(); leadsQuery.refetch(); },
  };
}
