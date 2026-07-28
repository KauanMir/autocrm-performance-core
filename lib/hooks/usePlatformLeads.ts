// lib/hooks/usePlatformLeads.ts — leitura de list_platform_leads_for_company
// para o Super Admin (M1-F S8-C2-B2). Caminho TOTALMENTE separado de
// useLeads/LeadService (Manager/Seller) — nunca a mesma query key ('platform'
// no lugar de 'active'/'archived' direto na raiz), nunca a mesma fonte, nunca
// adaptado para o formato mock (Lead legado com urgency/timeline calculados —
// decisão humana explícita do S8-C2-B2: os campos reais de `leads` (name,
// phone, car, stage_id, seller_id, archived_at, urgency, created_at, ...) são
// exibidos como estão, nunca traduzidos para um objeto Lead artificial).
import { useQuery } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { fetchPlatformLeads, type PlatformLeadRow } from '@/lib/commercial/repository';

export type UsePlatformLeadsOptions = {
  companyId: string | null;
  archived: boolean;
  // Resolvido pelo chamador (platformRole==='super_admin' &&
  // isSuperAdminCommercialReadEnabled()) — este hook não decide autorização.
  authorized: boolean;
};

export type UsePlatformLeadsResult = {
  queryEnabled: boolean;
  leads: readonly PlatformLeadRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const DISABLED_QUERY_KEY = ['company', null, 'leads', 'platform', 'disabled'] as const;
const EMPTY_LEADS: readonly PlatformLeadRow[] = Object.freeze([]);

export function usePlatformLeads(options: UsePlatformLeadsOptions): UsePlatformLeadsResult {
  const { companyId, archived, authorized } = options;
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const queryEnabled = authorized && hasCompany;
  const queryKey = hasCompany
    ? (archived
      ? platformCommercialQueryKeys.leadsArchived(companyId as string)
      : platformCommercialQueryKeys.leadsActive(companyId as string))
    : DISABLED_QUERY_KEY;

  const query = useQuery<PlatformLeadRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchPlatformLeads(companyId as string, archived),
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
    leads: data ?? EMPTY_LEADS,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
