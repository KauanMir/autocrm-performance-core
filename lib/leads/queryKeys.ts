// lib/leads/queryKeys.ts — query keys de leads remotos (M1-E, fase E2).
// Padrão do M1-D: partição SEMPRE por companyId — o companyId é só partição
// de cache, nunca prova de autorização (a query não envia company_id; RLS
// decide). Nenhuma key carrega role, token, email ou nome de estágio.
//
// Hierarquia (design §14): a listagem padrão (ativos) usa a própria raiz
// ['company', companyId, 'leads']; arquivados, detalhe e timeline são
// sub-keys — invalidar a raiz alcança todas, e nenhuma colide com outra.
//
// Diferente das keys de stages (que normalizam null), aqui companyId/leadId
// são obrigatórios e não vazios: os hooks do M1-E fazem gating por `enabled`
// ANTES de montar a key, então receber vazio aqui é bug de programação e
// falha alto em vez de particionar cache em key inválida.

function requireId(value: string, label: 'companyId' | 'leadId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`leadQueryKeys: ${label} é obrigatório e não pode ser vazio`);
  }
  return value;
}

export const leadQueryKeys = {
  // Raiz de leads da empresa — também é a key da listagem de ativos (a query
  // padrão filtra archived_at is null; design §14).
  root: (companyId: string) =>
    ['company', requireId(companyId, 'companyId'), 'leads'] as const,

  active: (companyId: string) => leadQueryKeys.root(companyId),

  archived: (companyId: string) =>
    [...leadQueryKeys.root(companyId), 'archived'] as const,

  detail: (companyId: string, leadId: string) =>
    [...leadQueryKeys.root(companyId), 'detail', requireId(leadId, 'leadId')] as const,

  timeline: (companyId: string, leadId: string) =>
    [...leadQueryKeys.root(companyId), 'timeline', requireId(leadId, 'leadId')] as const,
};
