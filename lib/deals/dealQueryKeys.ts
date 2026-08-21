// lib/deals/dealQueryKeys.ts — query keys de Deals remotas
// (COMMERCIAL-REMOTE-DEALS-B2-A). Mesmo padrão de lib/visits/visitQueryKeys.ts/
// lib/tasks/taskQueryKeys.ts: partição SEMPRE por companyId — o companyId é
// só partição de cache, nunca prova de autorização (a query não envia
// company_id; RLS decide). Nenhuma key carrega role, token, seller id ou
// user id — troca de identidade é responsabilidade de
// lib/query/resetQueryCache.ts, nunca da key em si.
//
// Sem sub-key de status (open/lost/sold): nenhum reader real deste lote
// precisa de um subconjunto filtrado — criar keys prematuras para isso
// seria especular sobre uma tela que ainda não existe (B2-A-PRECHECK §17).

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('dealQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const dealQueryKeys = {
  root: (companyId: string) => ['company', requireCompanyId(companyId), 'deals'] as const,
  active: (companyId: string) => dealQueryKeys.root(companyId),
};
