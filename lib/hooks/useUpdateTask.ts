// lib/hooks/useUpdateTask.ts — mutation de edição de Task remota (FULL
// REPLACE) para Manager/Seller (COMMERCIAL-REMOTE-B1-B2-C2-A). Identidade
// por parâmetro (mesmo padrão de useCreateTask/useUpdateLead). SEM retry
// automático — update_task usa optimistic locking via expectedVersion
// (retry cego reenviaria uma versão já obsoleta). SEM mutation otimista:
// o valor exibido só muda depois da resposta real, via invalidation.
//
// Input FULL REPLACE (contrato já congelado no repository,
// lib/tasks/remoteTaskMutationRepository.ts — não reaberto aqui):
// taskId/expectedVersion/title/note/priority/dueAt/assignedSellerId,
// nenhum campo opcional. Reagendar due_at, por exemplo, exige reenviar os
// demais campos ATUAIS — este hook não busca/preenche nada por conta
// própria, só encaminha o payload full-replace tal como recebido.
//
// Política de invalidação em conflito (precheck B1-B2-C2 §15, aplicada via
// runTaskMutationWithGenerationGuard/onConflictError): stale_write,
// task_completed e task_not_found invalidam taskQueryKeys.active (cache
// pode estar desatualizado); forbidden/invalid_title/seller_required/
// seller_not_found NÃO invalidam (erro de payload/autorização, não de
// cache desatualizado).
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { updateRemoteTask } from '@/lib/tasks/remoteTaskMutationRepository';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { isRemoteTasksError, mapRemoteTasksMutationError } from '@/lib/tasks/errors';
import { runTaskMutationWithGenerationGuard } from '@/lib/tasks/taskMutationGeneration';

export type UseUpdateTaskOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UpdateTaskCallInput = {
  taskId: string;
  expectedVersion: number;
  title: string;
  note: string;
  priority: Database['public']['Enums']['task_priority'];
  dueAt: string;
  assignedSellerId: string;
};

export type UseUpdateTaskResult = {
  updateTask: (input: UpdateTaskCallInput) => Promise<RemoteTaskRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type UpdateTaskMutationResult = {
  row: RemoteTaskRow;
  capturedCompanyId: string;
};

// update_task: códigos de erro reais confirmados na migration #51 que
// indicam cache local possivelmente desatualizado — nunca adivinhados.
const UPDATE_TASK_INVALIDATE_ON_CODES = new Set([
  'remote_tasks_mutation_stale_write',
  'remote_tasks_mutation_task_completed',
  'remote_tasks_mutation_task_not_found',
]);

export function useUpdateTask(options: UseUpdateTaskOptions): UseUpdateTaskResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<UpdateTaskMutationResult, unknown, UpdateTaskCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const taskRemoteMode = resolveTaskRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (taskRemoteMode !== 'task_remote_ready' || !hasIdentity) {
        throw mapRemoteTasksMutationError({ message: 'forbidden' }, 'update_task');
      }
      if (typeof input.expectedVersion !== 'number') {
        throw mapRemoteTasksMutationError({ message: 'stale_write' }, 'update_task');
      }

      const capturedCompanyId = companyId as string;

      const row = await runTaskMutationWithGenerationGuard(
        queryClient,
        'update_task',
        () =>
          updateRemoteTask({
            taskId: input.taskId,
            expectedVersion: input.expectedVersion,
            title: input.title,
            note: input.note,
            priority: input.priority,
            dueAt: input.dueAt,
            assignedSellerId: input.assignedSellerId,
          }),
        {
          onConflictError: (error) => {
            if (isRemoteTasksError(error) && UPDATE_TASK_INVALIDATE_ON_CODES.has(error.code)) {
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
    updateTask: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
