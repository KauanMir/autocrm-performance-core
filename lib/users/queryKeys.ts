// lib/users/queryKeys.ts — query keys da listagem administrativa de usuários
// ativos (M1-F S5-D). Mesmo padrão de lib/invites/queryKeys.ts (partição por
// userId — identidade, nunca prova de autorização — combinada com o escopo):
// Super Admin em escopo de plataforma (com companyId opcional, só filtro
// visual — nunca autorização, §22.2 do design); Manager sempre em escopo de
// empresa, com companyId SEMPRE derivado de activeMembership.companyId,
// nunca de um seletor global (não existe nesta etapa — pertence ao S7).
//
// role/search entram na key porque list_company_users os aceita como
// parâmetros server-side — trocar qualquer um deles é uma listagem
// logicamente diferente, nunca deve reaproveitar o cache da anterior.

export type CompanyUserScope =
  | { kind: 'platform'; companyId: string | null }
  | { kind: 'company'; companyId: string };

export type CompanyUserRoleFilter = 'manager' | 'seller' | null;

function requireUserId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('companyUserQueryKeys: userId é obrigatório e não pode ser vazio');
  }
  return value;
}

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('companyUserQueryKeys: companyId é obrigatório e não pode ser vazio para escopo company');
  }
  return value;
}

// Normalização só para fins de CHAVE (nunca para o payload enviado à RPC,
// que faz seu próprio trim/nullif do lado do servidor) — garante que " " e
// "" produzam a mesma partição de cache que "sem busca".
function normalizeSearchKey(search: string | null | undefined): string {
  const trimmed = (search ?? '').trim();
  return trimmed === '' ? '' : trimmed.toLowerCase();
}

export const companyUserQueryKeys = {
  root: (userId: string) => ['company-users', requireUserId(userId)] as const,

  list: (
    userId: string,
    scope: CompanyUserScope,
    role: CompanyUserRoleFilter,
    search: string | null | undefined,
  ) =>
    scope.kind === 'company'
      ? ([
          ...companyUserQueryKeys.root(userId),
          'company',
          requireCompanyId(scope.companyId),
          role ?? 'all',
          normalizeSearchKey(search),
        ] as const)
      : ([
          ...companyUserQueryKeys.root(userId),
          'platform',
          scope.companyId ?? 'all',
          role ?? 'all',
          normalizeSearchKey(search),
        ] as const),
};
