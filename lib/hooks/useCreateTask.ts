// lib/hooks/useCreateTask.ts — mutation de criação de Task remota para
// Manager/Seller (COMMERCIAL-REMOTE-B1-B2-C2-A). Identidade por parâmetro
// (mesmo padrão de useTasks/useCreateLead — nunca importa AuthService).
// SEM retry automático (create_task não é idempotente — reenviar cria uma
// SEGUNDA Task). SEM mutation otimista, SEM setQueryData: sucesso invalida
// taskQueryKeys.active(companyId) e deixa o refetch decidir a nova lista
// (RLS é autoridade, precheck B1-B2-C2 §9/§13).
//
// Input discriminado por actorRole (mesmo padrão de CreateLeadCallInput,
// useCreateLead.ts): a variante 'seller' estruturalmente NÃO TEM campo
// assignedSellerId — nenhum caller Seller consegue compilar um envio de
// responsável arbitrário (o backend sempre autoatribui). Manager EXIGE
// assignedSellerId em tempo de compilação (create_task lança
// seller_required se ausente). Além disso, input.actorRole é conferido em
// runtime contra o membershipRole real do hook (§6/§22 do EXEC) — nenhum
// caller consegue alegar um actorRole diferente da própria identidade para
// contornar o contrato.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/lib/supabase/database.types';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { createRemoteTask } from '@/lib/tasks/remoteTaskMutationRepository';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { mapRemoteTasksMutationError } from '@/lib/tasks/errors';
import { runTaskMutationWithGenerationGuard } from '@/lib/tasks/taskMutationGeneration';

export type UseCreateTaskOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

type CreateTaskCommonFields = {
  title: string;
  priority: Database['public']['Enums']['task_priority'];
  dueAt: string;
  leadId?: string | null;
  note?: string;
};

export type CreateTaskCallInput =
  | (CreateTaskCommonFields & { actorRole: 'manager'; assignedSellerId: string })
  | (CreateTaskCommonFields & { actorRole: 'seller' });

export type UseCreateTaskResult = {
  createTask: (input: CreateTaskCallInput) => Promise<RemoteTaskRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CreateTaskMutationResult = {
  row: RemoteTaskRow;
  capturedCompanyId: string;
};

export function useCreateTask(options: UseCreateTaskOptions): UseCreateTaskResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateTaskMutationResult, unknown, CreateTaskCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const taskRemoteMode = resolveTaskRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      // Mode inválido OU identidade incompleta: falha fechada, nenhuma RPC
      // (precheck B1-B2-C2 §6/§20/§21).
      if (taskRemoteMode !== 'task_remote_ready' || !hasIdentity) {
        throw mapRemoteTasksMutationError({ message: 'forbidden' }, 'create_task');
      }

      // Consistência de role (§6/§22): input.actorRole PRECISA corresponder
      // ao membershipRole real do hook — nenhum caller consegue contornar
      // "Manager exige responsável" ou "Seller nunca escolhe" alegando um
      // actorRole diferente da própria identidade.
      if (input.actorRole !== membershipRole) {
        throw mapRemoteTasksMutationError({ message: 'forbidden' }, 'create_task');
      }

      const capturedCompanyId = companyId as string;

      const row = await runTaskMutationWithGenerationGuard(queryClient, 'create_task', () =>
        createRemoteTask(
          input.actorRole === 'manager'
            ? {
                title: input.title,
                priority: input.priority,
                dueAt: input.dueAt,
                assignedSellerId: input.assignedSellerId,
                leadId: input.leadId,
                note: input.note,
              }
            : {
                title: input.title,
                priority: input.priority,
                dueAt: input.dueAt,
                leadId: input.leadId,
                note: input.note,
                // assignedSellerId OMITIDO de propósito — Seller sempre
                // autoatribuído pelo backend (create_task, actor_kind
                // 'seller').
              },
        ),
      );
      // create_task não tem nenhum código de erro que justifique invalidar
      // taskQueryKeys.active em conflito (sem p_expected_version — não
      // existe stale_write para create; forbidden/seller_required/
      // seller_not_found/lead_not_found/invalid_title são todos erros de
      // payload/autorização, precheck §15/§27) — por isso nenhum
      // onConflictError é passado aqui.

      return { row, capturedCompanyId };
    },
    onSuccess: ({ capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.active(capturedCompanyId) });
    },
  });

  return {
    createTask: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
