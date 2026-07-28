// lib/commercial/leadDisplay.ts — helpers PUROS de exibição para a
// superfície comercial do Super Admin (M1-F S8-C2-B2). Sem rede, sem React.
//
// Vendedor: NUNCA um nome (sellers não tem policy de SELECT nenhuma desde o
// S8-C1-A, e não existe RPC de leitura própria para resolver seller_id ->
// nome dentro do escopo desta etapa — decisão humana explícita: não inventar
// o dado, não criar SQL nesta etapa, distinguir apenas atribuído/não
// atribuído). Etapa: um stage_id fora do índice recebido cai em texto seguro
// ('Etapa indisponível') em vez de desaparecer silenciosamente da lista.
export const LEAD_UNASSIGNED_LABEL = 'Sem vendedor';
export const LEAD_ASSIGNED_LABEL = 'Vendedor atribuído';
export const LEAD_STAGE_UNAVAILABLE_LABEL = 'Etapa indisponível';

export type LeadAssignmentState = 'assigned' | 'unassigned';

export function resolveLeadAssignmentState(sellerId: string | null): LeadAssignmentState {
  return sellerId !== null && sellerId !== undefined ? 'assigned' : 'unassigned';
}

export function formatLeadAssignmentLabel(sellerId: string | null): string {
  return resolveLeadAssignmentState(sellerId) === 'assigned' ? LEAD_ASSIGNED_LABEL : LEAD_UNASSIGNED_LABEL;
}

export function resolveLeadStageName(
  stageId: string,
  stagesById: Readonly<Record<string, { name: string }>>,
): string {
  return stagesById[stageId]?.name ?? LEAD_STAGE_UNAVAILABLE_LABEL;
}
