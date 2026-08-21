// lib/hooks/useAdaptedRemoteDeals.ts — view-model reativo de Deals remotas
// (COMMERCIAL-REMOTE-DEALS-B2-A). Composição fina: RemoteDealRow[] →
// AdaptDealRowsResult, via lib/deals/adapter.ts (nunca duplica a lógica de
// adaptação).
//
// Diferente de useAdaptedRemoteVisits/useAdaptedRemoteTasks: sem contexto
// externo (leadsById) — client_name_snapshot já vem resolvido na própria
// row (B2-A-PRECHECK §10). `rows` é o único gatilho real de reatividade.
import { useMemo } from 'react';
import { adaptRemoteDealRows } from '@/lib/deals/adapter';
import type { AdaptDealRowsResult, RemoteDealRow } from '@/lib/deals/adapter';

export function useAdaptedRemoteDeals(rows: readonly RemoteDealRow[]): AdaptDealRowsResult {
  return useMemo(() => adaptRemoteDealRows(rows), [rows]);
}
