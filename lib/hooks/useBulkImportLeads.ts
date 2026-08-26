// lib/hooks/useBulkImportLeads.ts — mutation hook para o wizard de
// importação em massa (CRM-BULK-IMPORT-B2). Reaproveita exclusivamente
// bulk_import_leads (B1) via lib/leads/bulkImportRepository.ts — nenhuma
// regra de negócio recalculada aqui, só orquestração de preview/commit +
// invalidação de cache.
//
// SEM retry automático (mutations.retry já é 0 no QueryClient padrão,
// mesmo motivo de useCreateLead/useCreatePlatformLead): um retry de rede
// espontâneo do react-query reenviaria a MESMA tentativa — o
// clientRequestId é responsabilidade do CHAMADOR (gerado uma vez por
// tentativa de importação, nunca por este hook), e é isso que protege
// contra duplicação mesmo que um retry aconteça.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  previewBulkImportLeads,
  commitBulkImportLeads,
  type BulkImportLeadsPayload,
  type BulkImportPreviewResponse,
  type BulkImportCommitResponse,
} from '@/lib/leads/bulkImportRepository';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';

export type UseBulkImportLeadsOptions = {
  authorized: boolean;
  // Determina qual árvore de cache invalidar após um commit com linhas
  // importadas — Manager/Seller (RLS) e Super Admin (platform) nunca
  // compartilham cache (lib/commercial/queryKeys.ts, comentário de topo).
  isSuperAdmin: boolean;
  companyId: string | null;
};

export type UseBulkImportLeadsResult = {
  preview: (payload: BulkImportLeadsPayload) => Promise<BulkImportPreviewResponse>;
  commit: (payload: BulkImportLeadsPayload) => Promise<BulkImportCommitResponse>;
  isPreviewPending: boolean;
  isCommitPending: boolean;
  resetPreview: () => void;
  resetCommit: () => void;
};

export function useBulkImportLeads(options: UseBulkImportLeadsOptions): UseBulkImportLeadsResult {
  const { authorized, isSuperAdmin, companyId } = options;
  const queryClient = useQueryClient();

  const previewMutation = useMutation<BulkImportPreviewResponse, unknown, BulkImportLeadsPayload>({
    retry: 0,
    mutationFn: async (payload) => {
      if (!authorized) throw new Error('bulk-import-not-allowed');
      return previewBulkImportLeads(payload);
    },
  });

  const commitMutation = useMutation<BulkImportCommitResponse, unknown, BulkImportLeadsPayload>({
    retry: 0,
    mutationFn: async (payload) => {
      if (!authorized) throw new Error('bulk-import-not-allowed');
      return commitBulkImportLeads(payload);
    },
    onSuccess: (result) => {
      // Só invalida quando algo REALMENTE entrou (importedCount>0) — um
      // resultado 100% duplicado/erro não muda a listagem de Leads,
      // invalidar seria trabalho sem efeito (mesmo raciocínio de
      // useCreateLead: nunca invalidar uma key sem motivo real).
      if (result.importedCount <= 0) return;
      if (typeof companyId !== 'string' || companyId.trim() === '') return;
      if (isSuperAdmin) {
        queryClient.invalidateQueries({ queryKey: platformCommercialQueryKeys.leadsRoot(companyId) });
      } else {
        // Invalida a RAIZ (não só 'active') — alcança arquivados/detalhe/
        // timeline e qualquer resumo da Home que particione pela mesma key
        // (lib/leads/queryKeys.ts, comentário de topo: "invalidar a raiz
        // alcança todas"). Nunca um reload de página.
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.root(companyId) });
      }
    },
  });

  return {
    preview: previewMutation.mutateAsync,
    commit: commitMutation.mutateAsync,
    isPreviewPending: previewMutation.isPending,
    isCommitPending: commitMutation.isPending,
    resetPreview: previewMutation.reset,
    resetCommit: commitMutation.reset,
  };
}
