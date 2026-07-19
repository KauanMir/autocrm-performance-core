// lib/hooks/usePipelineStages.ts — leitura dos estágios do pipeline (M1-D,
// commit 5). Ainda NÃO consumido por nenhuma tela.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) — este
// hook não importa AuthService nem lê usuário global. Rules of Hooks: useQuery
// é chamado SEMPRE, na mesma ordem, com `enabled` fazendo o gating; nenhum
// hook condicional.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS (stages_select)
// é a autoridade de isolamento; o companyId aparece apenas na query key, para
// particionar o cache por empresa. Com flag ON, erro remoto ou name-mismatch
// NUNCA caem para a lista local (sem mistura de fontes).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { isRemoteStagesEnabled } from '@/lib/flags';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';
import {
  adaptPipelineStageRows,
  type AdaptPipelineStagesResult,
  type PipelineStage,
} from '@/lib/pipeline/adapter';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';
import type { PipelineStageRow } from '@/lib/supabase/types';

export type UsePipelineStagesOptions = {
  userId?: string | null;
  companyId?: string | null;
  userIsActive: boolean;
  localStageNames: readonly string[];
};

export type PipelineStagesConfigError = Extract<
  AdaptPipelineStagesResult,
  { ok: false }
>;

export type UsePipelineStagesResult = {
  source: 'local' | 'remote';
  remoteStagesEnabled: boolean;
  queryEnabled: boolean;
  queryKey: ReturnType<typeof pipelineStageQueryKeys.byCompany>;
  stages: readonly PipelineStage[];
  byId: Readonly<Record<string, PipelineStage>>;
  byCode: Readonly<Record<string, PipelineStage>>;
  byName: Readonly<Record<string, PipelineStage>>;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: PipelineStagesConfigError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Constantes vazias congeladas — nunca mutadas, apenas compartilhadas como
// valores de retorno quando não há dados.
const EMPTY_STAGES: readonly PipelineStage[] = Object.freeze([]);
const EMPTY_INDEX: Readonly<Record<string, PipelineStage>> = Object.freeze({});

// Type predicate — o narrowing por truthiness do discriminante não é
// confiável com strict:false no tsconfig atual.
function isConfigError(
  result: AdaptPipelineStagesResult,
): result is PipelineStagesConfigError {
  return result.ok === false;
}

function buildIndexes(stages: readonly PipelineStage[]) {
  const byId: Record<string, PipelineStage> = {};
  const byCode: Record<string, PipelineStage> = {};
  const byName: Record<string, PipelineStage> = {};
  for (const stage of stages) {
    byId[stage.id] = stage;
    byCode[stage.code] = stage;
    byName[stage.name] = stage;
  }
  return { byId, byCode, byName };
}

export function usePipelineStages(
  options: UsePipelineStagesOptions,
): UsePipelineStagesResult {
  const { userId, companyId, userIsActive, localStageNames } = options;

  const remoteStagesEnabled = isRemoteStagesEnabled();

  const queryEnabled =
    remoteStagesEnabled &&
    Boolean(userId) &&
    Boolean(companyId) &&
    userIsActive;

  const queryKey = pipelineStageQueryKeys.byCompany(companyId ?? null);

  // Declarada SEMPRE (flag OFF ⇒ enabled=false, zero chamadas). Usa os
  // defaults do QueryClient do AppProviders — nada de staleTime/retry aqui.
  const query = useQuery<AdaptPipelineStagesResult>({
    queryKey,
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, code, name, sort_order, is_terminal')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      // O select projeta 5 colunas; o adapter só lê essas 5 (created_at/
      // updated_at do Row nunca são acessados) — cast localizado e seguro.
      return adaptPipelineStageRows(
        (data ?? []) as unknown as PipelineStageRow[],
      );
    },
  });

  // ── Caminho LOCAL (flag OFF): comportamento legado, tolerante ──────────
  if (!remoteStagesEnabled) {
    const stages = adaptLocalStageNames(localStageNames);
    const { byId, byCode, byName } = buildIndexes(stages);
    return {
      source: 'local',
      remoteStagesEnabled,
      queryEnabled: false,
      queryKey,
      stages,
      byId,
      byCode,
      byName,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      configError: null,
      isEmpty: stages.length === 0,
      hasData: stages.length > 0,
      refetch: query.refetch,
    };
  }

  // ── Caminho REMOTO (flag ON): fonte única, sem fallback local ──────────
  const data = query.data;
  let configError: PipelineStagesConfigError | null = null;
  let okData: Extract<AdaptPipelineStagesResult, { ok: true }> | null = null;
  if (data) {
    if (isConfigError(data)) configError = data;
    else okData = data;
  }

  return {
    source: 'remote',
    remoteStagesEnabled,
    queryEnabled,
    queryKey,
    stages: okData ? okData.stages : EMPTY_STAGES,
    byId: okData ? okData.byId : EMPTY_INDEX,
    byCode: okData ? okData.byCode : EMPTY_INDEX,
    byName: okData ? okData.byName : EMPTY_INDEX,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    configError,
    isEmpty: Boolean(okData && okData.stages.length === 0),
    hasData: Boolean(okData && okData.stages.length > 0),
    refetch: query.refetch,
  };
}
