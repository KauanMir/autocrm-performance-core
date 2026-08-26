// lib/hooks/useReorderFollowUpTemplates.ts — mutation de reordenar Follow-up
// Templates (FOLLOW-UP-TEMPLATES-A3-EXEC). Payload atômico único
// (reorder_followup_templates) — nunca N updates individuais pelo browser.
// SEM optimistic update: a ordem visual só muda quando o cache é atualizado
// com o retorno da RPC (onSuccess) — mesmo padrão de useReorderStages.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { reorderRemoteFollowUpTemplates } from '@/lib/followupTemplates/mutationRepository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { runFollowUpTemplateMutationWithGenerationGuard } from '@/lib/followupTemplates/mutationGeneration';

export type UseReorderFollowUpTemplatesOptions = {
  userId?: string | null;
  companyId?: string | null;
  writeAuthorized: boolean;
  isSuperAdminContext: boolean;
};

export type UseReorderFollowUpTemplatesResult = {
  reorderTemplates: (orderedIds: readonly string[]) => Promise<FollowUpTemplateModel[]>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useReorderFollowUpTemplates(options: UseReorderFollowUpTemplatesOptions): UseReorderFollowUpTemplatesResult {
  const { userId, companyId, writeAuthorized, isSuperAdminContext } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<{ rows: FollowUpTemplateModel[]; capturedCompanyId: string }, unknown, readonly string[]>({
    retry: 0,
    mutationFn: async (orderedIds) => {
      const hasIdentity = writeAuthorized
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== '';
      if (!hasIdentity) {
        throw mapRemoteFollowUpTemplatesMutationError({ message: 'forbidden' }, 'reorder_followup_templates');
      }
      const capturedCompanyId = companyId as string;

      const rows = await runFollowUpTemplateMutationWithGenerationGuard(queryClient, 'reorder_followup_templates', () =>
        reorderRemoteFollowUpTemplates({
          orderedIds,
          companyId: isSuperAdminContext ? capturedCompanyId : null,
        }),
      );

      return { rows, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.management(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.platform(capturedCompanyId) });
    },
  });

  return {
    reorderTemplates: async (orderedIds) => (await mutation.mutateAsync(orderedIds)).rows,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
