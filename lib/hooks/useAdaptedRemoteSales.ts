// lib/hooks/useAdaptedRemoteSales.ts — view-model reativo de Sales remotas
// (COMMERCIAL-REMOTE-SALES-A2). Composição fina: RemoteSaleRow[] →
// AdaptSaleRowsResult, via lib/sales/adapter.ts (nunca duplica a lógica de
// adaptação). Mesmo padrão exato de lib/hooks/useAdaptedRemoteDeals.ts.
import { useMemo } from 'react';
import { adaptRemoteSaleRows } from '@/lib/sales/adapter';
import type { AdaptSaleRowsResult, RemoteSaleRow } from '@/lib/sales/adapter';

export function useAdaptedRemoteSales(rows: readonly RemoteSaleRow[]): AdaptSaleRowsResult {
  return useMemo(() => adaptRemoteSaleRows(rows), [rows]);
}
