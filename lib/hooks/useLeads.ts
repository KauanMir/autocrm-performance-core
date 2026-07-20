// lib/hooks/useLeads.ts — leitura remota de leads (M1-E, E3). Ainda NÃO
// consumido por nenhuma tela.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) — este
// hook não importa AuthService nem lê usuário global. Rules of Hooks: useQuery
// é chamado SEMPRE, na mesma ordem, com `enabled` fazendo o gating.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS (leads_select)
// é a autoridade de isolamento; o companyId aparece apenas na query key, para
// particionar o cache por empresa. Com flag ON, erro remoto ou erro de
// configuração NUNCA caem para os leads locais (sem mistura de fontes, sem
// initialData/placeholderData locais).
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import {
  adaptLeadRows,
  type AdaptLeadRowsResult,
  type LeadAdapterContext,
  type LeadAdapterError,
  type LeadModel,
} from '@/lib/leads/adapter';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { fetchActiveLeadRows } from '@/lib/leads/remoteRepository';

export type UseLeadsOptions = {
  userId?: string | null;
  companyId?: string | null;
  userIsActive: boolean;
  // Índices explícitos (mesmo shape do byId de usePipelineStages e do
  // LeadAdapterContext) — o hook não resolve stages/sellers sozinho.
  stagesById: LeadAdapterContext['stagesById'];
  sellersById: LeadAdapterContext['sellersById'];
  // O chamador declara quando os índices estão prontos (ex.: hasData do
  // usePipelineStages) — evita adaptar leads contra um índice vazio em load.
  stagesReady: boolean;
  sellersReady: boolean;
};

export type UseLeadsResult = {
  remoteLeadsEnabled: boolean;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  leads: readonly LeadModel[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: LeadAdapterError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=false,
// zero requests): as keys reais têm string no segundo segmento, então esta
// nunca colide com cache de empresa alguma.
const DISABLED_LEADS_QUERY_KEY = ['company', null, 'leads', 'disabled'] as const;

const EMPTY_LEADS: readonly LeadModel[] = Object.freeze([]);

// Type predicate — narrowing por truthiness do discriminante não é confiável
// com strict:false no tsconfig atual (mesmo padrão de usePipelineStages).
function isLeadsConfigError(result: AdaptLeadRowsResult): result is LeadAdapterError {
  return result.ok === false;
}

export function useLeads(options: UseLeadsOptions): UseLeadsResult {
  const {
    userId,
    companyId,
    userIsActive,
    stagesById,
    sellersById,
    stagesReady,
    sellersReady,
  } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const queryEnabled =
    remoteLeadsEnabled &&
    Boolean(userId) &&
    hasCompany &&
    userIsActive &&
    stagesReady &&
    sellersReady;

  const queryKey = hasCompany
    ? leadQueryKeys.active(companyId as string)
    : DISABLED_LEADS_QUERY_KEY;

  // Declarada SEMPRE (flag OFF ⇒ enabled=false, zero chamadas). Usa os
  // defaults do QueryClient do AppProviders — nada de staleTime/retry aqui
  // (mesmos valores aprovados para pipeline stages).
  const query = useQuery<AdaptLeadRowsResult>({
    queryKey,
    enabled: queryEnabled,
    queryFn: async () => {
      const rows = await fetchActiveLeadRows();
      return adaptLeadRows(rows, { stagesById, sellersById });
    },
  });

  const data = query.data;
  let configError: LeadAdapterError | null = null;
  let okLeads: readonly LeadModel[] | null = null;
  if (data) {
    if (isLeadsConfigError(data)) configError = data;
    else okLeads = data.leads;
  }

  return {
    remoteLeadsEnabled,
    queryEnabled,
    queryKey,
    leads: okLeads ?? EMPTY_LEADS,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    configError,
    isEmpty: Boolean(okLeads && okLeads.length === 0),
    hasData: Boolean(okLeads && okLeads.length > 0),
    refetch: query.refetch,
  };
}
