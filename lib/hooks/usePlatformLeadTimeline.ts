// lib/hooks/usePlatformLeadTimeline.ts — leitura de
// list_platform_lead_timeline para o Super Admin (M1-F S8-C2-B2). Caminho
// TOTALMENTE separado da timeline mock (FlowVerCliente lê lead.timeline
// embutido no objeto local, formato incompatível) — mostra as linhas reais
// de lead_timeline_entries (icon/color/label/detail/occurred_at/
// actor_profile_id), nunca convertidas para aquele formato.
import { useQuery } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { fetchPlatformLeadTimeline, type PlatformLeadTimelineRow } from '@/lib/commercial/repository';

export type UsePlatformLeadTimelineOptions = {
  companyId: string | null;
  leadId: string | null;
  // Resolvido pelo chamador (platformRole==='super_admin' &&
  // isSuperAdminCommercialReadEnabled()) — este hook não decide autorização.
  authorized: boolean;
};

export type UsePlatformLeadTimelineResult = {
  queryEnabled: boolean;
  entries: readonly PlatformLeadTimelineRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const DISABLED_QUERY_KEY = ['company', null, 'leads', 'platform', 'timeline', 'disabled'] as const;
const EMPTY_ENTRIES: readonly PlatformLeadTimelineRow[] = Object.freeze([]);

export function usePlatformLeadTimeline(
  options: UsePlatformLeadTimelineOptions,
): UsePlatformLeadTimelineResult {
  const { companyId, leadId, authorized } = options;
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasLead = typeof leadId === 'string' && leadId.trim() !== '';
  const queryEnabled = authorized && hasCompany && hasLead;
  const queryKey = hasCompany && hasLead
    ? platformCommercialQueryKeys.leadTimeline(companyId as string, leadId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<PlatformLeadTimelineRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchPlatformLeadTimeline(companyId as string, leadId as string),
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
    entries: data ?? EMPTY_ENTRIES,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
