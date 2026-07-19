// lib/pipeline/adapter.ts — adapter de pipeline_stages (M1-D, commit 4).
// Puro: sem rede, sem React, sem store, sem feature flag. Converte as rows do
// Supabase no modelo de UI e valida ESTRITAMENTE a compatibilidade com os
// cards locais.
//
// DÍVIDA TEMPORÁRIA (até o módulo de migração dos leads): lead.stage no
// localStorage guarda o NAME de exibição do estágio — por isso os 5 names
// remotos abaixo são invariantes e qualquer divergência (rename, faltante,
// extra, caixa, duplicata) é reportada como 'name-mismatch' em vez de
// corrigida/normalizada silenciosamente. Nenhum fallback local aqui: quem
// decide a interface do erro é o futuro hook/tela.
import type { PipelineStageRow } from '@/lib/supabase/types';

// ── Modelo de UI (camelCase) ─────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isTerminal: boolean;
}

// ── Nomes esperados pelos cards locais (comparação exata, case-sensitive,
//    sem trim, independente da ordem recebida) ────────────────────────────

export const EXPECTED_STAGE_NAMES = [
  'Novo',
  'Qualificado',
  'Visita agendada',
  'Em negociação',
  'Fechamento',
] as const;

// ── Resultado discriminado ───────────────────────────────────────────────

export type AdaptPipelineStagesResult =
  | {
      ok: true;
      stages: PipelineStage[];
      byId: Readonly<Record<string, PipelineStage>>;
      byCode: Readonly<Record<string, PipelineStage>>;
      byName: Readonly<Record<string, PipelineStage>>;
    }
  | {
      ok: false;
      reason: 'name-mismatch';
      expectedNames: readonly string[];
      receivedNames: string[];
      missingNames: string[];
      unexpectedNames: string[];
      duplicateNames: string[];
    };

// ── Função principal ─────────────────────────────────────────────────────

export function adaptPipelineStageRows(
  rows: readonly PipelineStageRow[],
): AdaptPipelineStagesResult {
  // Zero rows é um estado vazio VÁLIDO (empresa sem estágios): o hook/tela
  // decide como exibir; não é mismatch.
  if (rows.length === 0) {
    return { ok: true, stages: [], byId: {}, byCode: {}, byName: {} };
  }

  const receivedNames = rows.map((r) => r.name);

  const received = new Set(receivedNames);
  const expected = new Set<string>(EXPECTED_STAGE_NAMES);

  const missingNames = EXPECTED_STAGE_NAMES.filter((n) => !received.has(n));
  const unexpectedNames = [...received].filter((n) => !expected.has(n));

  const seen = new Set<string>();
  const duplicateNames = [
    ...new Set(
      receivedNames.filter((n) => {
        if (seen.has(n)) return true;
        seen.add(n);
        return false;
      }),
    ),
  ];

  if (missingNames.length > 0 || unexpectedNames.length > 0 || duplicateNames.length > 0) {
    return {
      ok: false,
      reason: 'name-mismatch',
      expectedNames: EXPECTED_STAGE_NAMES,
      receivedNames,
      missingNames,
      unexpectedNames,
      duplicateNames,
    };
  }

  // Cópia ordenada por sort_order crescente — o array recebido nunca é mutado.
  const stages = [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(
      (r): PipelineStage => ({
        id: r.id,
        code: r.code,
        name: r.name,
        sortOrder: r.sort_order,
        isTerminal: r.is_terminal,
      }),
    );

  const byId: Record<string, PipelineStage> = {};
  const byCode: Record<string, PipelineStage> = {};
  const byName: Record<string, PipelineStage> = {};
  for (const stage of stages) {
    byId[stage.id] = stage;
    byCode[stage.code] = stage;
    byName[stage.name] = stage;
  }

  return { ok: true, stages, byId, byCode, byName };
}
