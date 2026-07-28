// lib/inactiveUsers/queryKeys.ts — query keys da leitura administrativa de
// memberships inativas (M1-F S6-E). Mesmo padrão de lib/users/queryKeys.ts
// (partição por userId — identidade, nunca prova de autorização —
// combinada com o escopo): Super Admin em escopo de plataforma (com
// companyId opcional, só filtro visual — nunca autorização, mesmo contrato
// de list_company_users); Manager sempre em escopo de empresa, com
// companyId SEMPRE derivado de activeMembership.companyId, nunca de um
// seletor global.
//
// role/lifecycle/search entram na key porque list_inactive_company_users os
// aceita como parâmetros server-side — trocar qualquer um deles é uma
// listagem logicamente diferente, nunca deve reaproveitar o cache da
// anterior.

export type InactiveCompanyUserScope =
  | { kind: 'platform'; companyId: string | null }
  | { kind: 'company'; companyId: string };

export type InactiveCompanyUserRoleFilter = 'manager' | 'seller' | null;
export type InactiveCompanyUserLifecycleFilter = 'suspended' | 'offboarded' | null;

function requireUserId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('inactiveCompanyUserQueryKeys: userId é obrigatório e não pode ser vazio');
  }
  return value;
}

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('inactiveCompanyUserQueryKeys: companyId é obrigatório e não pode ser vazio para escopo company');
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

export const inactiveCompanyUserQueryKeys = {
  root: (userId: string) => ['inactive-company-users', requireUserId(userId)] as const,

  list: (
    userId: string,
    scope: InactiveCompanyUserScope,
    role: InactiveCompanyUserRoleFilter,
    lifecycle: InactiveCompanyUserLifecycleFilter,
    search: string | null | undefined,
  ) =>
    scope.kind === 'company'
      ? ([
          ...inactiveCompanyUserQueryKeys.root(userId),
          'company',
          requireCompanyId(scope.companyId),
          role ?? 'all',
          lifecycle ?? 'all',
          normalizeSearchKey(search),
        ] as const)
      : ([
          ...inactiveCompanyUserQueryKeys.root(userId),
          'platform',
          scope.companyId ?? 'all',
          role ?? 'all',
          lifecycle ?? 'all',
          normalizeSearchKey(search),
        ] as const),
};
