// lib/hooks/useUpdateFollowUpTemplate.ts — mutation de edição de Follow-up
// Template (FOLLOW-UP-TEMPLATES-A3-EXEC). FULL REPLACE (mesmo contrato de
// update_followup_template/update_task) — nenhum campo opcional além de
// expectedVersion já ser exigido pelo caller. Sem mutation otimista;
// conflito de versão (followup_template_conflict) é exposto tal como veio,
// nunca sobrescrito silenciosamente (precheck A3-EXEC §14).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { updateRemoteFollowUpTemplate } from '@/lib/followupTemplates/mutationRepository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { runFollowUpTemplateMutationWithGenerationGuard } from '@/lib/followupTemplates/mutationGeneration';

export type UseUpdateFollowUpTemplateOptions = {
  userId?: string | null;
  companyId?: string | null;
  writeAuthorized: boolean;
  isSuperAdminContext: boolean;
};

export type UpdateFollowUpTemplateInput = {
  templateId: string;
  expectedVersion: number;
  name: string;
  taskTitle: string;
  taskNote: string;
  priority: Database['public']['Enums']['task_priority'];
  offsetValue: number;
  offsetUnit: string;
  defaultTime: string | null;
};

export type UseUpdateFollowUpTemplateResult = {
  updateTemplate: (input: UpdateFollowUpTemplateInput) => Promise<FollowUpTemplateModel>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useUpdateFollowUpTemplate(options: UseUpdateFollowUpTemplateOptions): UseUpdateFollowUpTemplateResult {
  const { userId, companyId, writeAuthorized, isSuperAdminContext } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<{ row: FollowUpTemplateModel; capturedCompanyId: string }, unknown, UpdateFollowUpTemplateInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity = writeAuthorized
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== '';
      if (!hasIdentity) {
        throw mapRemoteFollowUpTemplatesMutationError({ message: 'forbidden' }, 'update_followup_template');
      }
      const capturedCompanyId = companyId as string;

      const row = await runFollowUpTemplateMutationWithGenerationGuard(queryClient, 'update_followup_template', () =>
        updateRemoteFollowUpTemplate({
          templateId: input.templateId,
          expectedVersion: input.expectedVersion,
          name: input.name,
          taskTitle: input.taskTitle,
          taskNote: input.taskNote,
          priority: input.priority,
          offsetValue: input.offsetValue,
          offsetUnit: input.offsetUnit,
          defaultTime: input.defaultTime,
          companyId: isSuperAdminContext ? capturedCompanyId : null,
        }),
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.active(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.management(capturedCompanyId) });
      queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.platform(capturedCompanyId) });
    },
  });

  return {
    updateTemplate: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
