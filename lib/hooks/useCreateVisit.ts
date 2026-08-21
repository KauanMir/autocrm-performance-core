// lib/hooks/useCreateVisit.ts — mutation de criação de Visit remota para
// Manager/Seller (COMMERCIAL-REMOTE-VISITS-B2-B). Identidade por parâmetro
// (mesmo padrão de useCreateTask/useCreateLead — nunca importa
// AuthService). SEM retry automático (create_visit não é idempotente —
// reenviar cria uma SEGUNDA Visit). SEM mutation otimista, SEM
// setQueryData: sucesso invalida visitQueryKeys.active(companyId) e deixa
// o refetch decidir a nova lista.
//
// Input discriminado por actorRole (mesmo padrão de CreateTaskCallInput):
// a variante 'seller' estruturalmente NÃO TEM campo assignedSellerId —
// nenhum caller Seller consegue compilar um envio de responsável
// arbitrário (o backend sempre autoatribui). Manager pode OMITIR
// assignedSellerId (o backend tenta o Seller do Lead, se houver e ativo) —
// diferente de Tasks, onde Manager sempre precisa escolher; aqui o próprio
// RPC decide entre default-do-Lead e seller_required. input.actorRole é
// conferido em runtime contra o membershipRole real do hook — nenhum
// caller consegue alegar um actorRole diferente da própria identidade.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { visitQueryKeys } from '@/lib/visits/visitQueryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { createRemoteVisit } from '@/lib/visits/remoteMutationRepository';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { mapRemoteVisitsMutationError } from '@/lib/visits/errors';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';

export type UseCreateVisitOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

type CreateVisitCommonFields = {
  scheduledAt: string;
  vehicles: readonly string[];
  leadId?: string | null;
  clientName?: string | null;
  note?: string;
};

export type CreateVisitCallInput =
  | (CreateVisitCommonFields & { actorRole: 'manager'; assignedSellerId?: string | null })
  | (CreateVisitCommonFields & { actorRole: 'seller' });

export type UseCreateVisitResult = {
  createVisit: (input: CreateVisitCallInput) => Promise<RemoteVisitRow>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

type CreateVisitMutationResult = {
  row: RemoteVisitRow;
  capturedCompanyId: string;
};

export function useCreateVisit(options: UseCreateVisitOptions): UseCreateVisitResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateVisitMutationResult, unknown, CreateVisitCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const visitRemoteMode = resolveVisitRemoteMode();
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      // Mode inválido OU identidade incompleta: falha fechada, nenhuma RPC.
      if (visitRemoteMode !== 'visit_remote_ready' || !hasIdentity) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'create_visit');
      }

      // Consistência de role: input.actorRole PRECISA corresponder ao
      // membershipRole real do hook — nenhum caller consegue contornar as
      // regras de seller alegando um actorRole diferente da própria
      // identidade.
      if (input.actorRole !== membershipRole) {
        throw mapRemoteVisitsMutationError({ message: 'forbidden' }, 'create_visit');
      }

      const capturedCompanyId = companyId as string;

      const row = await runVisitMutationWithGenerationGuard(queryClient, 'create_visit', () =>
        createRemoteVisit(
          input.actorRole === 'manager'
            ? {
                scheduledAt: input.scheduledAt,
                vehicles: input.vehicles,
                leadId: input.leadId,
                clientName: input.clientName,
                assignedSellerId: input.assignedSellerId,
                note: input.note,
              }
            : {
                scheduledAt: input.scheduledAt,
                vehicles: input.vehicles,
                leadId: input.leadId,
                clientName: input.clientName,
                note: input.note,
                // assignedSellerId OMITIDO de propósito — Seller sempre
                // autoatribuído pelo backend (create_visit, actor_kind
                // 'seller').
              },
        ),
      );
      // create_visit não tem nenhum código de erro que justifique invalidar
      // visitQueryKeys.active em conflito (sem p_expected_version — não
      // existe stale_write para create; forbidden/seller_required/
      // seller_not_found/lead_not_found/lead_archived/
      // client_name_required/invalid_vehicles são todos erros de
      // payload/autorização) — por isso nenhum onConflictError é passado
      // aqui (mesmo raciocínio de useCreateTask).

      return { row, capturedCompanyId };
    },
    onSuccess: ({ row, capturedCompanyId }) => {
      queryClient.invalidateQueries({ queryKey: visitQueryKeys.active(capturedCompanyId) });
      // RPC já escreveu o evento de timeline atomicamente quando lead_id
      // existe (record_lead_timeline_event, dentro da própria transação) —
      // aqui só invalidamos o cache de leitura para refletir, nenhum
      // client-side write.
      if (row.lead_id !== null) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.timeline(capturedCompanyId, row.lead_id) });
      }
    },
  });

  return {
    createVisit: async (input) => (await mutation.mutateAsync(input)).row,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
