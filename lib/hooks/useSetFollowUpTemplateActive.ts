// lib/hooks/useSetFollowUpTemplateActive.ts — mutation de ativar/desativar
// Follow-up Template (FOLLOW-UP-TEMPLATES-A3-EXEC). Toggle dedicado —
// nunca via update. Reativar pode ser negado com
// remote_followup_templates_mutation_limit_reached (12 ativos/empresa) —
// erro exposto tal como veio, traduzido pela UI (getFollowUpTemplateErrorMessage).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUpTemplateQueryKeys } from '@/lib/followupTemplates/queryKeys';
import { setRemoteFollowUpTemplateActive } from '@/lib/followupTemplates/mutationRepository';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';
import { mapRemoteFollowUpTemplatesMutationError } from '@/lib/followupTemplates/errors';
import { runFollowUpTemplateMutationWithGenerationGuard } from '@/lib/followupTemplates/mutationGeneration';

export type UseSetFollowUpTemplateActiveOptions = {
  userId?: string | null;
  companyId?: string | null;
  writeAuthorized: boolean;
  isSuperAdminContext: boolean;
};

export type SetFollowUpTemplateActiveInput = {
  templateId: string;
  expectedVersion: number;
  isActive: boolean;
};

export type UseSetFollowUpTemplateActiveResult = {
  setActive: (input: SetFollowUpTemplateActiveInput) => Promise<FollowUpTemplateModel>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

export function useSetFollowUpTemplateActive(options: UseSetFollowUpTemplateActiveOptions): UseSetFollowUpTemplateActiveResult {
  const { userId, companyId, writeAuthorized, isSuperAdminContext } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<{ row: FollowUpTemplateModel; capturedCompanyId: string }, unknown, SetFollowUpTemplateActiveInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity = writeAuthorized
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== '';
      if (!hasIdentity) {
        throw mapRemoteFollowUpTemplatesMutationError({ message: 'forbidden' }, 'set_followup_template_active');
      }
      const capturedCompanyId = companyId as string;

      const row = await runFollowUpTemplateMutationWithGenerationGuard(queryClient, 'set_followup_template_active', () =>
        setRemoteFollowUpTemplateActive({
          templateId: input.templateId,
          expectedVersion: input.expectedVersion,
          isActive: input.isActive,
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
    setActive: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
