// lib/leads/leadMutationOwnership.ts — autorização visual pura, por Lead
// individual, para mover Etapa/aplicar evento (M1-E E5-A1). Função separada
// de lib/leads/mutationCapabilities.ts: aquele módulo resolve a capability
// GENÉRICA do ator ("este ator pode, em tese, mover Etapa?"); este módulo
// resolve se um Lead ESPECÍFICO pode ser mutado por ele agora (Seller só no
// próprio, Manager em qualquer um da empresa) — só faz sentido combinado com
// uma capability já true.
//
// Função pura: sem React, sem Supabase, sem flags. Não decide nada sozinha —
// a autoridade real continua em RLS/resolve_lead_mutation_context (mesmo
// disclaimer de mutationCapabilities.ts). Enquanto canMoveStage/
// canApplyEvents permanecerem false (E5-A1), este helper nunca é chamado
// pela UI: ele é preparado e testado agora para o E5-B1/B2 ligarem depois,
// sem alterar nenhum comportamento visível hoje.
export type LeadMutationOwnershipActorRole = 'manager' | 'seller';

export type CanActorMutateLeadInput = {
  // Capability genérica já resolvida pelo chamador (canMoveStage ou
  // canApplyEvents de resolveLeadMutationCapabilities) — este helper nunca
  // resolve capability sozinho, só refina por posse do Lead.
  capability: boolean;
  actorRole: LeadMutationOwnershipActorRole | null | undefined;
  // sellerId do ator autenticado — só significativo quando actorRole==='seller'.
  actorSellerId?: string | null;
  // seller_id do Lead alvo — null/undefined quando o Lead não tem vendedor
  // atribuído (Seller nunca pode operar nesse caso).
  leadSellerId?: string | null;
};

// Manager operacional: qualquer Lead da própria empresa (a empresa já é
// isolada por RLS/resolve_lead_mutation_context — este helper não repete
// isolamento de empresa, só posse dentro dela).
// Seller operacional: somente quando leadSellerId === actorSellerId, e
// ambos precisam ser strings não vazias (Lead sem seller, ou Seller sem
// sellerId resolvido, nunca autorizam).
export function canActorMutateLead(input: CanActorMutateLeadInput): boolean {
  const { capability, actorRole, actorSellerId, leadSellerId } = input;

  if (!capability) return false;
  if (actorRole === 'manager') return true;
  if (actorRole === 'seller') {
    if (typeof actorSellerId !== 'string' || actorSellerId.trim() === '') return false;
    if (typeof leadSellerId !== 'string' || leadSellerId.trim() === '') return false;
    return leadSellerId === actorSellerId;
  }
  return false;
}
