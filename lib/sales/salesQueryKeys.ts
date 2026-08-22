// lib/sales/salesQueryKeys.ts — query keys de Sales remotas (COMMERCIAL-
// REMOTE-SALES-A2). Mesmo padrão de lib/deals/dealQueryKeys.ts: partição
// SEMPRE por companyId — o companyId é só partição de cache, nunca prova de
// autorização (a query não envia company_id; RLS decide). Nenhuma key
// carrega role, token, seller id ou user id — troca de identidade é
// responsabilidade de lib/query/resetQueryCache.ts, nunca da key em si.
function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('salesQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const salesQueryKeys = {
  root: (companyId: string) => ['company', requireCompanyId(companyId), 'sales'] as const,
  active: (companyId: string) => salesQueryKeys.root(companyId),
};
