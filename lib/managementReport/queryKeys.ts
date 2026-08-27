// lib/managementReport/queryKeys.ts — KPI-REPORTS-B2-EXEC-FRONTEND §7.
// Query keys do relatório gerencial. Mesmo padrão de
// companySellerLeaderboardQueryKey: partição SEMPRE por companyId (cache
// de Company A e Company B NUNCA se cruzam) + período (troca de preset/
// custom => nova consulta) + userId (consistência com os hooks irmãos;
// troca de identidade continua sendo responsabilidade de
// lib/query/resetQueryCache.ts, nunca da key). A key nunca carrega role,
// token nem seller id; ela não é prova de autorização (a RPC + RLS
// decidem).

export function managementReportQueryKey(
  companyId: string,
  userId: string,
  periodStartMillis: number,
  periodEndMillis: number,
) {
  return ['company', companyId, 'management-report', 'remote', userId, periodStartMillis, periodEndMillis] as const;
}

// Prefixo estável (sem userId/período) para invalidar TODO o relatório de
// uma empresa de uma vez — invalidateQueries faz match por prefixo por
// padrão. Nenhum consumidor do B2 invalida (a tela é 100% read-only), mas
// mantido para simetria com o padrão do Pódio.
export function managementReportQueryPrefix(companyId: string) {
  return ['company', companyId, 'management-report', 'remote'] as const;
}
