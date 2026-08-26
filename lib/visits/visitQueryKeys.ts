// lib/visits/visitQueryKeys.ts — query keys de Visits remotas
// (COMMERCIAL-REMOTE-VISITS-B2-A). Mesmo padrão de lib/tasks/taskQueryKeys.ts:
// partição SEMPRE por companyId — o companyId é só partição de cache,
// nunca prova de autorização (a query não envia company_id; RLS decide).
// Nenhuma key carrega role, token, seller id ou user id — troca de
// identidade é responsabilidade de lib/query/resetQueryCache.ts, nunca da
// key em si.
//
// Sem sub-key de status/outcome/KPI: nenhum reader real deste lote precisa
// de um subconjunto filtrado — criar keys prematuras para isso seria
// especular sobre uma tela que ainda não existe (B2-PRECHECK §11).

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('visitQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const visitQueryKeys = {
  root: (companyId: string) => ['company', requireCompanyId(companyId), 'visits'] as const,
  active: (companyId: string) => visitQueryKeys.root(companyId),
  // SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — partição PRÓPRIA
  // (nunca a mesma key de `.active`), mesmo motivo de taskQueryKeys.platform.
  platform: (companyId: string) => ['company', requireCompanyId(companyId), 'visits', 'platform'] as const,
};
