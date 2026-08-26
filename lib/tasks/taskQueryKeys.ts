// lib/tasks/taskQueryKeys.ts — query keys de Tasks remotas
// (COMMERCIAL-REMOTE-B1-B2-A). Mesmo padrão de lib/leads/queryKeys.ts:
// partição SEMPRE por companyId — o companyId é só partição de cache,
// nunca prova de autorização (a query não envia company_id; RLS decide).
// Nenhuma key carrega role, token, seller id ou user id — troca de
// identidade é responsabilidade de lib/query/resetQueryCache.ts (limpa o
// QueryClient inteiro e incrementa a geração), nunca da key em si; duas
// keys distintas para a MESMA company/modo diferente criariam dois caches
// com semântica inconsistente.
//
// Sem sub-key de arquivados/detalhe: não existe conceito de Task
// arquivada no produto, e não existe tela de detalhe de Task — só a raiz
// (que já é a listagem ativa/pending, B1-B2 precheck §11) é necessária.

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('taskQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const taskQueryKeys = {
  root: (companyId: string) => ['company', requireCompanyId(companyId), 'tasks'] as const,
  active: (companyId: string) => taskQueryKeys.root(companyId),
  // SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — partição PRÓPRIA
  // (nunca a mesma key de `.active`, §16/§23 do EXEC): o bridge do Super
  // Admin contextual (list_platform_tasks_for_company) nunca deve
  // colidir/reaproveitar o cache de Manager/Seller (fontes e autoridades
  // diferentes, mesmo quando apontam para a mesma empresa).
  platform: (companyId: string) => ['company', requireCompanyId(companyId), 'tasks', 'platform'] as const,
};
