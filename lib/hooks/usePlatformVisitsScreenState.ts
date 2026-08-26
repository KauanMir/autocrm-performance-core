// lib/hooks/usePlatformVisitsScreenState.ts —
// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC. Mesmo padrão exato de
// usePlatformTasksScreenState.ts — bridge EXCLUSIVO do Super Admin
// contextual, Manager/Seller continuam em useRemoteVisitsScreenState,
// intocado. Mesmo shape de saída de UseRemoteVisitsScreenStateResult.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPlatformVisitRows } from '@/lib/visits/remoteRepository';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { usePlatformLeads } from '@/lib/hooks/usePlatformLeads';
import { useAdaptedRemoteVisits } from '@/lib/hooks/useAdaptedRemoteVisits';
import {
  isVisitAdapterError,
  type RemoteVisitModel,
  type RemoteVisitRow,
  type VisitAdapterError,
  type VisitLeadRef,
} from '@/lib/visits/adapter';
import type { UseRemoteVisitsScreenStateResult } from '@/lib/hooks/useRemoteVisitsScreenState';

const DISABLED_QUERY_KEY = ['company', null, 'visits', 'platform', 'disabled'] as const;
const EMPTY_ROWS: readonly RemoteVisitRow[] = Object.freeze([]);
const EMPTY_VISITS: readonly RemoteVisitModel[] = Object.freeze([]);

export function usePlatformVisitsScreenState(companyId: string | null): UseRemoteVisitsScreenStateResult {
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const query = useQuery<RemoteVisitRow[]>({
    queryKey: hasCompany ? visitQueryKeys.platform(companyId as string) : DISABLED_QUERY_KEY,
    enabled: hasCompany,
    queryFn: () => fetchPlatformVisitRows(companyId as string),
  });

  const leadsQuery = usePlatformLeads({ companyId, archived: false, authorized: hasCompany });
  const leadsById = useMemo(() => {
    const map: Record<string, VisitLeadRef> = {};
    for (const lead of leadsQuery.leads) {
      map[lead.id] = { id: lead.id, name: lead.name };
    }
    return map;
  }, [leadsQuery.leads]);

  const isActive = hasCompany;
  const activeLoading = isActive && (query.isLoading || leadsQuery.isLoading);
  const activeError = isActive && (query.isError || leadsQuery.isError);

  const rowsForAdaptation = isActive && !activeLoading && !activeError ? (query.data ?? EMPTY_ROWS) : EMPTY_ROWS;
  const adapted = useAdaptedRemoteVisits(rowsForAdaptation, leadsById);

  let visits: readonly RemoteVisitModel[] = EMPTY_VISITS;
  let configError: VisitAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isVisitAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.visits.length === 0) {
      isEmpty = true;
    } else {
      visits = adapted.visits;
      hasData = true;
    }
  }

  return {
    mode: isActive ? 'visit_remote_active' : 'visit_remote_unavailable_identity',
    visits,
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
