// lib/hooks/useReorderStages.ts — mutation do reorder de etapas (M1-D,
// commit 7). Chama public.reorder_pipeline_stages(uuid[]) SEM enviar
// company_id/user_id/role — a RPC deriva tudo de auth.uid() e é a autoridade
// real (autenticação, role, profile ativo, permutação completa, empresa).
//
// SEM optimistic update: o cache só muda em onSuccess, com o retorno da RPC
// normalizado pelo adapter; em erro o cache permanece exatamente como estava.
// Identidade vem por parâmetro — nada de AuthService aqui.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';
import {
  adaptPipelineStageRows,
  type AdaptPipelineStagesResult,
} from '@/lib/pipeline/adapter';
import type { PipelineStageRow } from '@/lib/supabase/types';

export type UseReorderStagesOptions = {
  companyId?: string | null;
  canReorder: boolean;
};

// Mensagens estáveis dos erros LOCAIS (pré-RPC) e de resposta inesperada —
// nunca exibidas cruas ao usuário (ver getReorderStagesErrorMessage).
export const REORDER_LOCAL_ERRORS = {
  notAllowed: 'reorder-not-allowed',
  missingCompany: 'reorder-missing-company',
  emptyList: 'reorder-empty-list',
  invalidId: 'reorder-invalid-id',
  duplicateIds: 'reorder-duplicate-ids',
  emptyResponse: 'reorder-empty-response',
  configMismatch: 'reorder-config-mismatch',
} as const;

type OkStages = Extract<AdaptPipelineStagesResult, { ok: true }>;

export type UseReorderStagesResult = {
  reorderStages: (orderedIds: readonly string[]) => Promise<OkStages>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset: () => void;
};

// Helper PURO de mensagens amigáveis — o erro original permanece disponível
// no hook para diagnóstico; nada de mensagem interna do PostgreSQL na UI.
export function getReorderStagesErrorMessage(error: unknown): string {
  const message = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : '';

  if (message === REORDER_LOCAL_ERRORS.notAllowed || message.includes('forbidden')) {
    return 'Você não tem permissão para reordenar as etapas.';
  }
  if (message === REORDER_LOCAL_ERRORS.missingCompany || message.includes('no active profile')) {
    return 'Sua sessão não possui um perfil ativo.';
  }
  if (code === '40P01' || code === '40001') {
    return 'Ocorreu um conflito ao salvar a ordem. Tente novamente.';
  }
  if (message === REORDER_LOCAL_ERRORS.configMismatch) {
    return 'As etapas retornadas não correspondem à configuração esperada.';
  }
  return 'Não foi possível salvar a nova ordem das etapas.';
}

export function useReorderStages(
  options: UseReorderStagesOptions,
): UseReorderStagesResult {
  const { companyId, canReorder } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<OkStages, unknown, readonly string[]>({
    mutationFn: async (orderedIds) => {
      // Invariantes locais simples — falhou, NÃO chama o Supabase e o cache
      // fica intacto. A validação completa (conjunto, empresa, role, ids
      // inexistentes) continua sendo responsabilidade da RPC.
      if (!canReorder) throw new Error(REORDER_LOCAL_ERRORS.notAllowed);
      if (!companyId) throw new Error(REORDER_LOCAL_ERRORS.missingCompany);
      if (orderedIds.length === 0) throw new Error(REORDER_LOCAL_ERRORS.emptyList);
      if (orderedIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
        throw new Error(REORDER_LOCAL_ERRORS.invalidId);
      }
      if (new Set(orderedIds).size !== orderedIds.length) {
        throw new Error(REORDER_LOCAL_ERRORS.duplicateIds);
      }

      // Payload: array NOVO e mutável — o array recebido nunca é modificado.
      const { data, error } = await supabase.rpc('reorder_pipeline_stages', {
        p_ordered_ids: [...orderedIds],
      });
      if (error) throw error;
      // Reorder válido sempre retorna os stages da empresa — null é anômalo.
      if (!data) throw new Error(REORDER_LOCAL_ERRORS.emptyResponse);

      const adapted = adaptPipelineStageRows(data as unknown as PipelineStageRow[]);
      if (!adapted.ok) throw new Error(REORDER_LOCAL_ERRORS.configMismatch);
      return adapted;
    },
    onSuccess: (adapted) => {
      // Atualiza SOMENTE a key da empresa atual, no MESMO formato que o
      // usePipelineStages armazena (AdaptPipelineStagesResult ok), e depois
      // invalida a mesma key para confirmação contra o remoto.
      const key = pipelineStageQueryKeys.byCompany(companyId ?? null);
      queryClient.setQueryData(key, adapted);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    reorderStages: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
