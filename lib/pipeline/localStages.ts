// lib/pipeline/localStages.ts — adaptação da lista local de names (M1-D,
// commit 5). Representa o caminho LEGADO (flag OFF): converte os names da
// store local para o mesmo formato PipelineStage do caminho remoto, sem mudar
// a fonte de verdade local. Tolerante de propósito: nome desconhecido é
// preservado com code/id sintéticos determinísticos, nunca lança erro.
// Puro: sem localStorage, sem store, sem React, sem Supabase.
import type { PipelineStage } from '@/lib/pipeline/adapter';

const LOCAL_NAME_TO_CODE: Readonly<Record<string, string>> = {
  'Novo': 'new',
  'Qualificado': 'qualified',
  'Visita agendada': 'visit_scheduled',
  'Em negociação': 'negotiation',
  'Fechamento': 'closing',
};

const TERMINAL_LOCAL_NAME = 'Fechamento';

// Slug determinístico para nomes locais fora do conjunto conhecido.
function syntheticCode(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `local_${slug || 'stage'}`;
}

export function adaptLocalStageNames(
  stageNames: readonly string[],
): PipelineStage[] {
  return stageNames.map((name, index): PipelineStage => {
    const code = LOCAL_NAME_TO_CODE[name] ?? syntheticCode(name);
    return {
      // Ids claramente locais e determinísticos (mesma entrada ⇒ mesmo id);
      // o índice cobre o caso extremo de names repetidos na lista legada.
      id: `local-${index}-${code}`,
      code,
      name,
      sortOrder: index, // preserva exatamente a ordem recebida
      isTerminal: name === TERMINAL_LOCAL_NAME,
    };
  });
}
