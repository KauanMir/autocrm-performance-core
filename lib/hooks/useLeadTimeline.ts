// lib/hooks/useLeadTimeline.ts — leitura da timeline remota de um Lead para
// Manager/Seller (M1-E, E7-B2-A1). Mesmo molde de usePlatformLeadTimeline
// (lib/hooks/usePlatformLeadTimeline.ts) — sem RPC própria (leitura direta
// via RLS, achado da auditoria E7-B2-A0), sem paginação e sem nome do ator
// (decisões humanas da etapa; ver lib/leads/timelineAdapter.ts).
//
// Identidade por parâmetro (mesmo padrão de useLeads/useCreateLead/
// useUpdateLead) — nunca importa AuthService. `authorized` é resolvido pelo
// chamador (dataSource==='remote' do LeadFlowContext, capabilities já
// decididas) — este hook não decide modo local/remote_misconfigured/
// Super Admin sozinho, só respeita o que recebe.
import { useQuery } from '@tanstack/react-query';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { fetchLeadTimelineEntries } from '@/lib/leads/timelineRepository';
import { adaptLeadTimelineEntries, type LeadTimelineEntry } from '@/lib/leads/timelineAdapter';

export type UseLeadTimelineOptions = {
  companyId: string | null;
  leadId: string | null;
  authorized: boolean;
};

export type UseLeadTimelineResult = {
  queryEnabled: boolean;
  entries: readonly LeadTimelineEntry[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela para quando não há contexto válido (enabled=false, zero
// requests) — nunca colide com leadQueryKeys.timeline (segundo segmento
// sempre string real ali).
const DISABLED_QUERY_KEY = ['company', null, 'leads', 'timeline', 'disabled'] as const;
const EMPTY_ENTRIES: readonly LeadTimelineEntry[] = Object.freeze([]);

export function useLeadTimeline(options: UseLeadTimelineOptions): UseLeadTimelineResult {
  const { companyId, leadId, authorized } = options;
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasLead = typeof leadId === 'string' && leadId.trim() !== '';
  const queryEnabled = authorized && hasCompany && hasLead;
  const queryKey = hasCompany && hasLead
    ? leadQueryKeys.timeline(companyId as string, leadId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<LeadTimelineEntry[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: async () => {
      const rows = await fetchLeadTimelineEntries(companyId as string, leadId as string);
      return adaptLeadTimelineEntries(rows);
    },
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
