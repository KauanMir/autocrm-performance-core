// lib/hooks/usePlatformSalesScreenState.ts —
// SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC. Mesmo padrão exato de
// usePlatformDealsScreenState.ts — bridge EXCLUSIVO do Super Admin
// contextual, Manager/Seller continuam em useRemoteSalesScreenState,
// intocado. Mesmo shape de saída de UseRemoteSalesScreenStateResult
// (mode/sales/isLoading/...), reaproveitado por ScreenVendas/
// ScreenResultados/Home (Funil comercial) sem reescrita de branching.
import { useQuery } from '@tanstack/react-query';
import { fetchPlatformSaleRows } from '@/lib/sales/remoteRepository';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';
import { useAdaptedRemoteSales } from '@/lib/hooks/useAdaptedRemoteSales';
import {
  isSaleAdapterError,
  type SaleAdapterError,
  type RemoteSaleModel,
  type RemoteSaleRow,
} from '@/lib/sales/adapter';
import type { UseRemoteSalesScreenStateResult } from '@/lib/hooks/useRemoteSalesScreenState';

const DISABLED_QUERY_KEY = ['company', null, 'sales', 'platform', 'disabled'] as const;
const EMPTY_ROWS: readonly RemoteSaleRow[] = Object.freeze([]);
const EMPTY_SALES: readonly RemoteSaleModel[] = Object.freeze([]);

export function usePlatformSalesScreenState(companyId: string | null): UseRemoteSalesScreenStateResult {
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const query = useQuery<RemoteSaleRow[]>({
    queryKey: hasCompany ? salesQueryKeys.platform(companyId as string) : DISABLED_QUERY_KEY,
    enabled: hasCompany,
    queryFn: () => fetchPlatformSaleRows(companyId as string),
  });

  const isActive = hasCompany;
  const activeLoading = isActive && query.isLoading;
  const activeError = isActive && query.isError;

  const rowsForAdaptation = isActive && !activeLoading && !activeError ? (query.data ?? EMPTY_ROWS) : EMPTY_ROWS;
  const adapted = useAdaptedRemoteSales(rowsForAdaptation);

  let sales: readonly RemoteSaleModel[] = EMPTY_SALES;
  let configError: SaleAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isSaleAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.sales.length === 0) {
      isEmpty = true;
    } else {
      sales = adapted.sales;
      hasData = true;
    }
  }

  return {
    mode: isActive ? 'sale_remote_active' : 'sale_remote_unavailable_identity',
    sales,
    isLoading: activeLoading,
    isFetching: isActive ? query.isFetching : false,
    isError: activeError,
    error: activeError ? query.error : null,
    configError,
    isEmpty,
    hasData,
    refetch: query.refetch,
  };
}
