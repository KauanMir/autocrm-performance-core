// lib/hooks/usePlatformDealsScreenState.ts —
// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC. Mesmo padrão de
// usePlatformTasksScreenState.ts, mas sem leadsById (o adapter de Deals
// não precisa — client_name_snapshot já vem resolvido na própria row,
// mesmo motivo já documentado em useRemoteDealsScreenState.ts). Bridge
// EXCLUSIVO do Super Admin contextual; Manager/Seller continuam em
// useRemoteDealsScreenState, intocado.
import { useQuery } from '@tanstack/react-query';
import { fetchPlatformDealRows } from '@/lib/deals/remoteRepository';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';
import { useAdaptedRemoteDeals } from '@/lib/hooks/useAdaptedRemoteDeals';
import {
  isDealAdapterError,
  type DealAdapterError,
  type RemoteDealModel,
  type RemoteDealRow,
} from '@/lib/deals/adapter';
import type { UseRemoteDealsScreenStateResult } from '@/lib/hooks/useRemoteDealsScreenState';

const DISABLED_QUERY_KEY = ['company', null, 'deals', 'platform', 'disabled'] as const;
const EMPTY_ROWS: readonly RemoteDealRow[] = Object.freeze([]);
const EMPTY_DEALS: readonly RemoteDealModel[] = Object.freeze([]);

export function usePlatformDealsScreenState(companyId: string | null): UseRemoteDealsScreenStateResult {
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const query = useQuery<RemoteDealRow[]>({
    queryKey: hasCompany ? dealQueryKeys.platform(companyId as string) : DISABLED_QUERY_KEY,
    enabled: hasCompany,
    queryFn: () => fetchPlatformDealRows(companyId as string),
  });

  const isActive = hasCompany;
  const activeLoading = isActive && query.isLoading;
  const activeError = isActive && query.isError;

  const rowsForAdaptation = isActive && !activeLoading && !activeError ? (query.data ?? EMPTY_ROWS) : EMPTY_ROWS;
  const adapted = useAdaptedRemoteDeals(rowsForAdaptation);

  let deals: readonly RemoteDealModel[] = EMPTY_DEALS;
  let configError: DealAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isDealAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.deals.length === 0) {
      isEmpty = true;
    } else {
      deals = adapted.deals;
      hasData = true;
    }
  }

  return {
    mode: isActive ? 'deal_remote_active' : 'deal_remote_unavailable_identity',
    deals,
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
