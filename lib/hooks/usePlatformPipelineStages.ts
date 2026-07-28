// lib/hooks/usePlatformPipelineStages.ts — leitura de
// list_pipeline_stages_for_company para o Super Admin (M1-F S8-C2-B2).
// Caminho TOTALMENTE separado de usePipelineStages (Manager/Seller, RLS
// direta em pipeline_stages) — nunca a mesma query key, nunca a mesma fonte.
// Somente leitura: nenhuma mutação, nenhum reorder, nenhuma chamada a
// reorder_pipeline_stages (S8-C1-B permanece intocado).
import { useQuery } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { fetchPlatformPipelineStages, type PlatformPipelineStageRow } from '@/lib/commercial/repository';

export type UsePlatformPipelineStagesOptions = {
  companyId: string | null;
  // Resolvido pelo chamador (platformRole==='super_admin' &&
  // isSuperAdminCommercialReadEnabled()) — este hook não decide autorização.
  authorized: boolean;
};

export type UsePlatformPipelineStagesResult = {
  queryEnabled: boolean;
  stages: readonly PlatformPipelineStageRow[];
  stagesById: Readonly<Record<string, PlatformPipelineStageRow>>;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const DISABLED_QUERY_KEY = ['company', null, 'pipeline-stages', 'platform', 'disabled'] as const;
const EMPTY_STAGES: readonly PlatformPipelineStageRow[] = Object.freeze([]);
const EMPTY_INDEX: Readonly<Record<string, PlatformPipelineStageRow>> = Object.freeze({});

export function usePlatformPipelineStages(
  options: UsePlatformPipelineStagesOptions,
): UsePlatformPipelineStagesResult {
  const { companyId, authorized } = options;
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const queryEnabled = authorized && hasCompany;
  const queryKey = hasCompany
    ? platformCommercialQueryKeys.stages(companyId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<PlatformPipelineStageRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchPlatformPipelineStages(companyId as string),
  });

  const data = query.data ?? null;
  const stages = data ?? EMPTY_STAGES;
  const stagesById: Record<string, PlatformPipelineStageRow> = {};
  if (data) {
    for (const stage of data) stagesById[stage.id] = stage;
  }

  return {
    queryEnabled,
    stages: [...stages].sort((a, b) => a.sort_order - b.sort_order),
    stagesById: data ? stagesById : EMPTY_INDEX,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
