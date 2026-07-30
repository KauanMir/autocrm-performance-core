// lib/hooks/useArchivedLeads.ts — leitura remota de Leads arquivados,
// exclusiva do Manager (M1-E, E6-B1). Nenhuma UI conectada nesta etapa —
// infraestrutura reservada para a futura aba "Arquivados" (E6-B2+).
//
// Diferente de useLeads: nunca habilitado para Seller (decisão humana do
// E6-A0 — a aba/lista de arquivados é decisão explícita de produto restrita
// ao Manager, não um acidente de RLS vazio) nem para Super Admin (usa a
// superfície Platform própria, com sua própria key de arquivados). Rules of
// Hooks: useQuery é sempre chamado, na mesma ordem — `enabled` faz o gating.
//
// Nunca alimenta remoteSnapshot/bridge/StoreAdapter — leitura isolada, key
// própria (leadQueryKeys.archived), nunca mistura com a listagem ativa.
import { useQuery } from '@tanstack/react-query';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { fetchArchivedLeadRows } from '@/lib/leads/remoteRepository';
import type { LeadRow } from '@/lib/supabase/types';

export type UseArchivedLeadsOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseArchivedLeadsResult = {
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  leads: readonly LeadRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=false,
// zero requests) — nunca colide com nenhuma key real de empresa.
const DISABLED_ARCHIVED_LEADS_QUERY_KEY = ['company', null, 'leads', 'archived', 'disabled'] as const;

const EMPTY_ARCHIVED_LEADS: readonly LeadRow[] = Object.freeze([]);

export function useArchivedLeads(options: UseArchivedLeadsOptions): UseArchivedLeadsResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  // Manager-only, e só em remote_ready (mesmo raciocínio de mutationCapabilities:
  // remote_misconfigured/local nunca habilitam nenhum acesso remoto de escrita
  // ou leitura restrita).
  const queryEnabled =
    resolveRemoteLeadsFlagMode() === 'remote_ready'
    && Boolean(userId)
    && hasCompany
    && userIsActive
    && membershipRole === 'manager';

  const queryKey = hasCompany
    ? leadQueryKeys.archived(companyId as string)
    : DISABLED_ARCHIVED_LEADS_QUERY_KEY;

  const query = useQuery<LeadRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchArchivedLeadRows,
  });

  return {
    queryEnabled,
    queryKey,
    leads: query.data ?? EMPTY_ARCHIVED_LEADS,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
