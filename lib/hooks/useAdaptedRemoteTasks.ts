// lib/hooks/useAdaptedRemoteTasks.ts — view-model reativo de Tasks remotas
// (COMMERCIAL-REMOTE-B1-B2-B3-B). Composição fina: RemoteTaskRow[] +
// leadsById + dayBoundaryKey → AdaptTaskRowsResult, via
// lib/tasks/deriveRemoteTasks.ts (nunca duplica a lógica de adaptação).
//
// `useDayBoundaryKey()` entra como dependência do useMemo (§10) — na
// virada do dia local, o dayKey muda e força um recálculo com um `now`
// novo, mudando o `state`/`when` das rows já carregadas (TODAY → LATE)
// sem nenhum refetch/invalidate/polling: as MESMAS rows, o MESMO
// leadsById, só um instante diferente passado ao adapter.
import { useMemo } from 'react';
import { useDayBoundaryKey } from '@/lib/hooks/useDayBoundaryKey';
import { deriveRemoteTasks } from '@/lib/tasks/deriveRemoteTasks';
import type { AdaptTaskRowsResult, RemoteTaskRow, TaskLeadRef } from '@/lib/tasks/taskAdapter';

export function useAdaptedRemoteTasks(
  rows: readonly RemoteTaskRow[],
  leadsById: Readonly<Record<string, TaskLeadRef>>,
): AdaptTaskRowsResult {
  const dayKey = useDayBoundaryKey();

  return useMemo(
    () => deriveRemoteTasks(rows, leadsById, new Date()),
    // dayKey de propósito, mesmo sem ser lido no corpo: é o gatilho da
    // virada de dia (§10). rows/leadsById cobrem os outros dois gatilhos
    // reais de reatividade (novas rows da query, catálogo de Lead
    // atualizado) — nenhum dos três dispara rede por si só.
    [rows, leadsById, dayKey],
  );
}
