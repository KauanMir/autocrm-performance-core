// lib/hooks/useManagementFollowUpTemplates.ts — leitura de templates
// (ativos+inativos) para Ajustes > Follow-ups (FOLLOW-UP-TEMPLATES-A3-EXEC).
// Dois caminhos de LEITURA distintos, nunca misturados na mesma key
// (precheck A3-EXEC §4):
//   - Manager: SELECT direto (RLS followup_templates_select já devolve
//     ativos+inativos para Manager) — followUpTemplateQueryKeys.management.
//   - Super Admin contextual: RPC list_platform_followup_templates_for_company
//     (p_include_inactive=true) — followUpTemplateQueryKeys.platform.
// `readAuthorized` decide SE a query roda (resolvido pelo chamador via
// canManageFollowUpTemplates OU visualização read-only em empresa suspensa
// — precheck A3-EXEC §18: Super Admin em empresa suspensa ainda LÊ, só não
// escreve); autorização de ESCRITA é responsabilidade de outro booleano no
// componente (writeAuthorized), nunca deste hook.
import { useQuery } from '@tanstack/react-query';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { fetchManagementFollowUpTemplates, fetchPlatformFollowUpTemplates } from '@/lib/followupTemplates/repository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

export type UseManagementFollowUpTemplatesOptions = {
  userId?: string | null;
  companyId?: string | null;
  readAuthorized: boolean;
  isSuperAdminContext: boolean;
};

export type ManagementFollowUpTemplatesState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; templates: readonly FollowUpTemplateModel[] };

const DISABLED_QUERY_KEY = ['followup-templates-management', null, null] as const;

export function useManagementFollowUpTemplates(options: UseManagementFollowUpTemplatesOptions): ManagementFollowUpTemplatesState {
  const { userId, companyId, readAuthorized, isSuperAdminContext } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const queryEnabled = readAuthorized && hasUser && hasCompany;
  const queryKey = hasCompany
    ? (isSuperAdminContext
        ? followUpTemplateQueryKeys.platform(companyId as string)
        : followUpTemplateQueryKeys.management(companyId as string))
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (Rules of Hooks) — enabled decide se de fato roda.
  const query = useQuery<FollowUpTemplateModel[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => (isSuperAdminContext
      ? fetchPlatformFollowUpTemplates(companyId as string)
      : fetchManagementFollowUpTemplates()),
  });

  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };
  return { status: 'ready', templates: query.data ?? [] };
}
