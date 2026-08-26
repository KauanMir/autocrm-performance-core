// lib/hooks/useActiveFollowUpTemplates.ts — leitura de templates ATIVOS
// para o picker Lead > Follow-up (FOLLOW-UP-TEMPLATES-A3-EXEC). Exclusivo
// de Manager/Seller (Super Admin nunca usa template para criar Task —
// precheck A2-EXEC §30 — então nunca chama este hook). Identidade por
// parâmetro (mesmo padrão de useCreateTask/usePipelineStages) — nunca
// importa AuthService.
import { useQuery } from '@tanstack/react-query';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { fetchActiveFollowUpTemplates } from '@/lib/followupTemplates/repository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

export type UseActiveFollowUpTemplatesOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseActiveFollowUpTemplatesResult = {
  templates: readonly FollowUpTemplateModel[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

const EMPTY: readonly FollowUpTemplateModel[] = Object.freeze([]);
const DISABLED_QUERY_KEY = ['followup-templates-active', null, null] as const;

export function useActiveFollowUpTemplates(options: UseActiveFollowUpTemplatesOptions): UseActiveFollowUpTemplatesResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasRole = membershipRole === 'manager' || membershipRole === 'seller';

  // Defesa em profundidade (mesmo padrão de useCreateTask): mesmo que o
  // caller esqueça de gatear a abertura do flow, este hook nunca busca fora
  // de task_remote_ready — Follow-up Templates não têm caminho local.
  const queryEnabled = userIsActive && hasUser && hasCompany && hasRole
    && resolveTaskRemoteMode() === 'task_remote_ready';

  const queryKey = hasCompany ? followUpTemplateQueryKeys.active(companyId as string) : DISABLED_QUERY_KEY;

  const query = useQuery<FollowUpTemplateModel[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchActiveFollowUpTemplates,
  });

  return {
    templates: queryEnabled ? (query.data ?? EMPTY) : EMPTY,
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
