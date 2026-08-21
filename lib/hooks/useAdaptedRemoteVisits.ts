// lib/hooks/useAdaptedRemoteVisits.ts — view-model reativo de Visits
// remotas (COMMERCIAL-REMOTE-VISITS-B2-A). Composição fina: RemoteVisitRow[]
// + leadsById → AdaptVisitRowsResult, via lib/visits/adapter.ts (nunca
// duplica a lógica de adaptação).
//
// Diferente de useAdaptedRemoteTasks: RemoteVisitModel não deriva nenhum
// campo relativo a "agora" (Tasks deriva `state`/`when` a partir de
// due_at+now — Visits não deriva nada do tipo neste lote, "pending result"
// fica para uma camada de apresentação futura, B2-PRECHECK §8/§14) —
// então não há necessidade de useDayBoundaryKey() aqui: rows/leadsById já
// são os dois únicos gatilhos reais de reatividade.
import { useMemo } from 'react';
import { adaptRemoteVisitRows } from '@/lib/visits/adapter';
import type { AdaptVisitRowsResult, RemoteVisitRow, VisitLeadRef } from '@/lib/visits/adapter';

export function useAdaptedRemoteVisits(
  rows: readonly RemoteVisitRow[],
  leadsById: Readonly<Record<string, VisitLeadRef>>,
): AdaptVisitRowsResult {
  return useMemo(
    () => adaptRemoteVisitRows(rows, { leadsById }),
    [rows, leadsById],
  );
}
