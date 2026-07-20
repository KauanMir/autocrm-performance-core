// lib/companies/queryKeys.ts — query keys da listagem administrativa de
// empresas (M1-F S3-B). Diferente de leadQueryKeys/pipelineStageQueryKeys
// (particionados por companyId), esta tela é GLOBAL da KAPA — sem empresa
// alvo (design §7.8: "Lista de empresas, criar empresa — global, sem
// empresa alvo") — então a partição de cache é por userId (identidade do
// Super Admin), nunca por selectedCompanyId (que não existe nesta etapa).
//
// userId aqui é só partição de cache, igual ao companyId em leadQueryKeys —
// nunca prova de autorização; a query não envia nenhum filtro de usuário, a
// RLS (can_access_company) decide o que volta.

function requireUserId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('platformCompanyQueryKeys: userId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const platformCompanyQueryKeys = {
  root: (userId: string) =>
    ['platform-admin', requireUserId(userId), 'companies'] as const,

  list: (userId: string) => platformCompanyQueryKeys.root(userId),
};
