// lib/hooks/useCreateFollowUpTemplate.ts — mutation de criação de Follow-up
// Template (FOLLOW-UP-TEMPLATES-A3-EXEC). Identidade por parâmetro — nunca
// importa AuthService. SEM retry automático (create_followup_template não é
// idempotente). SEM mutation otimista: sucesso invalida as 3 query keys da
// empresa (active/management/platform) e deixa o refetch decidir.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { createRemoteFollowUpTemplate } from '@/lib/followupTemplates/mutationRepository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { runFollowUpTemplateMutationWithGenerationGuard } from '@/lib/followupTemplates/mutationGeneration';

export type UseCreateFollowUpTemplateOptions = {
  userId?: string | null;
  companyId?: string | null;
  writeAuthorized: boolean;
  isSuperAdminContext: boolean;
};

export type CreateFollowUpTemplateInput = {
  name: string;
  taskTitle: string;
  taskNote?: string;
  priority: Database['public']['Enums']['task_priority'];
  offsetValue: number;
  offsetUnit: string;
  defaultTime?: string | null;
};

export type UseCreateFollowUpTemplateResult = {
  createTemplate: (input: CreateFollowUpTemplateInput) => Promise<FollowUpTemplateModel>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

function invalidateFollowUpTemplateQueries(queryClient: ReturnType<typeof useQueryClient>, companyId: string) {
  queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.active(companyId) });
  queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.management(companyId) });
  queryClient.invalidateQueries({ queryKey: followUpTemplateQueryKeys.platform(companyId) });
}

export function useCreateFollowUpTemplate(options: UseCreateFollowUpTemplateOptions): UseCreateFollowUpTemplateResult {
  const { userId, companyId, writeAuthorized, isSuperAdminContext } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<{ row: FollowUpTemplateModel; capturedCompanyId: string }, unknown, CreateFollowUpTemplateInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity = writeAuthorized
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== '';
      if (!hasIdentity) {
        throw mapRemoteFollowUpTemplatesMutationError({ message: 'forbidden' }, 'create_followup_template');
      }
      const capturedCompanyId = companyId as string;

      const row = await runFollowUpTemplateMutationWithGenerationGuard(queryClient, 'create_followup_template', () =>
        createRemoteFollowUpTemplate({
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
      invalidateFollowUpTemplateQueries(queryClient, capturedCompanyId);
    },
  });

  return {
    createTemplate: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
