// lib/hooks/useCompleteTask.ts — mutation de conclusão de Task remota para
// Manager/Seller (COMMERCIAL-REMOTE-B1-B2-C2-A). Identidade por parâmetro
// (mesmo padrão de useCreateTask/useUpdateTask). SEM retry automático. SEM
// mutation otimista/setQueryData: complete_task retorna a row já com
// status='completed', mas taskQueryKeys.active(companyId) só contém
// pending (fetchPendingTaskRows) — a Task concluída sai da lista via
// refetch pós-invalidation, nunca por remoção manual do cache (precheck
// B1-B2-C2 §12/§13, mesmo tradeoff de UX aceito por archive_lead).
//
// Política de invalidação em conflito (§15, via onConflictError):
// stale_write, already_completed e task_not_found invalidam
// taskQueryKeys.active; forbidden NÃO invalida.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { completeRemoteTask } from '@/lib/tasks/remoteTaskMutationRepository';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { isRemoteTasksError, mapRemoteTasksMutationError } from '@/lib/tasks/errors';
import { runTaskMutationWithGenerationGuard } from '@/lib/tasks/taskMutationGeneration';

export type UseCompleteTaskOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type CompleteTaskCallInput = {
  taskId: string;
  expectedVersion: number;
};

export type UseCompleteTaskResult = {
  completeTask: (input: CompleteTaskCallInput) => Promise<RemoteTaskRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CompleteTaskMutationResult = {
  row: RemoteTaskRow;
  capturedCompanyId: string;
};

// complete_task: códigos de erro reais confirmados na migration #51 que
// indicam cache local possivelmente desatualizado.
const COMPLETE_TASK_INVALIDATE_ON_CODES = new Set([
  'remote_tasks_mutation_stale_write',
  'remote_tasks_mutation_already_completed',
  'remote_tasks_mutation_task_not_found',
]);

export function useCompleteTask(options: UseCompleteTaskOptions): UseCompleteTaskResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CompleteTaskMutationResult, unknown, CompleteTaskCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const taskRemoteMode = resolveTaskRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (taskRemoteMode !== 'task_remote_ready' || !hasIdentity) {
        throw mapRemoteTasksMutationError({ message: 'forbidden' }, 'complete_task');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteTasksMutationError({ message: 'stale_write' }, 'complete_task');
      }

      const capturedCompanyId = companyId as string;

      const row = await runTaskMutationWithGenerationGuard(
        queryClient,
        'complete_task',
        () =>
          completeRemoteTask({
            taskId: input.taskId,
            expectedVersion: input.expectedVersion,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteTasksError(error) && COMPLETE_TASK_INVALIDATE_ON_CODES.has(error.code)) {
              queryClient.invalidateQueries({ queryKey: taskQueryKeys.active(capturedCompanyId) });
            }
          },
        },
      );

      return { row, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.active(capturedCompanyId) });
    },
  });

  return {
    completeTask: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
