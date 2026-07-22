// lib/invites/queryKeys.ts — query keys da listagem administrativa de
// convites (M1-F S4-F1). Mesmo padrão de lib/companies/queryKeys.ts
// (partição por userId — identidade, nunca prova de autorização) combinado
// com o padrão de lib/leads/queryKeys.ts (partição também por companyId
// quando o escopo é de empresa) — aqui os dois se combinam porque a
// listagem de convites tem DOIS escopos possíveis (§6 do S4-F1): Manager
// sempre com companyId explícito da própria membership; Super Admin em
// escopo de plataforma (sem empresa alvo nesta etapa — S7 decide o resto).
//
// scope.kind na key (não só o companyId) evita que 'company'/'platform' do
// MESMO usuário colidam numa única partição — trocar de escopo nunca
// reaproveita cache do outro.

export type AdminInviteScope =
  | { kind: 'company'; companyId: string }
  | { kind: 'platform' };

function requireUserId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('adminInviteQueryKeys: userId é obrigatório e não pode ser vazio');
  }
  return value;
}

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('adminInviteQueryKeys: companyId é obrigatório e não pode ser vazio para escopo company');
  }
  return value;
}

export const adminInviteQueryKeys = {
  root: (userId: string) => ['admin-invites', requireUserId(userId)] as const,

  list: (userId: string, scope: AdminInviteScope) =>
    scope.kind === 'company'
      ? ([...adminInviteQueryKeys.root(userId), 'company', requireCompanyId(scope.companyId)] as const)
      : ([...adminInviteQueryKeys.root(userId), 'platform'] as const),
};
