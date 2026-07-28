// lib/hooks/useInactiveCompanyUsers.ts — leitura paginada da listagem
// administrativa de memberships inativas (M1-F S6-E). Identidade e
// autorização vêm por parâmetro (o chamador resolve currentUser + capability
// + o escopo) — este hook não importa AuthService nem lib/capabilities.
// Mesmo padrão de lib/hooks/useCompanyUsers.ts. Rules of Hooks:
// useInfiniteQuery é chamado SEMPRE, na mesma ordem, com `enabled` fazendo o
// gating.
//
// NÃO wired em nenhuma tela (ScreenAjustes ou outra) — camada de dados
// isolada, sem consumidor visual nesta etapa (M1-F S6-E é hardening de
// backend/identidade/cache, não frontend).
//
// Paginação: list_inactive_company_users nunca devolve has_more/total_count,
// mesmo contrato de list_company_users. Cursor por (updated_at, membership_id)
// — não (created_at, membership_id) — reflete a última mudança de lifecycle,
// não a criação original da membership (ver migration m1f_s6e).
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  inactiveCompanyUserQueryKeys,
  type InactiveCompanyUserLifecycleFilter,
  type InactiveCompanyUserRoleFilter,
  type InactiveCompanyUserScope,
} from '@/lib/inactiveUsers/queryKeys';
import {
  fetchInactiveCompanyUsers,
  type InactiveCompanyUserCursor,
  type InactiveCompanyUserRow,
} from '@/lib/inactiveUsers/repository';

export const INACTIVE_COMPANY_USERS_DEFAULT_LIMIT = 25;

export type UseInactiveCompanyUsersOptions = {
  userId?: string | null;
  // Resolvido pelo chamador — este hook não decide autorização, só usa o
  // resultado para o gating.
  authorized: boolean;
  // null quando o escopo ainda não pode ser determinado (ex.: actor nulo) —
  // a query fica desabilitada nesse caso, nunca assume um escopo implícito.
  scope: InactiveCompanyUserScope | null;
  role: InactiveCompanyUserRoleFilter;
  lifecycle: InactiveCompanyUserLifecycleFilter;
  // Já normalizado/debounced pelo chamador (trim; null = busca desativada).
  search: string | null;
  limit?: number;
};

export type UseInactiveCompanyUsersResult = {
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  users: readonly InactiveCompanyUserRow[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  hasMore: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há userId/scope válidos ou o
// chamador não está autorizado (enabled=false, zero requests) — o segundo
// segmento nunca é uma string real, então nunca colide com o cache de
// nenhuma identidade/escopo real.
const DISABLED_INACTIVE_COMPANY_USERS_QUERY_KEY = ['inactive-company-users', null, 'disabled'] as const;

const EMPTY_USERS: readonly InactiveCompanyUserRow[] = Object.freeze([]);

export function useInactiveCompanyUsers(options: UseInactiveCompanyUsersOptions): UseInactiveCompanyUsersResult {
  const { userId, authorized, scope, role, lifecycle, search, limit = INACTIVE_COMPANY_USERS_DEFAULT_LIMIT } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';

  const queryEnabled = authorized && hasUser && scope !== null;
  const queryKey = hasUser && scope !== null
    ? inactiveCompanyUserQueryKeys.list(userId as string, scope, role, lifecycle, search)
    : DISABLED_INACTIVE_COMPANY_USERS_QUERY_KEY;

  const query = useInfiniteQuery<InactiveCompanyUserRow[]>({
    queryKey,
    enabled: queryEnabled,
    initialPageParam: null as InactiveCompanyUserCursor | null,
    queryFn: ({ pageParam }) =>
      fetchInactiveCompanyUsers({
        limit,
        cursor: pageParam as InactiveCompanyUserCursor | null,
        search,
        companyId: scope !== null ? scope.companyId : null,
        role,
        lifecycle,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < limit) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { updatedAt: last.updated_at, membershipId: last.membership_id } satisfies InactiveCompanyUserCursor;
    },
  });

  const pages = query.data?.pages ?? [];
  const users = pages.length > 0 ? pages.flat() : EMPTY_USERS;

  return {
    queryEnabled,
    queryKey,
    users,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(queryEnabled && !query.isLoading && !query.isError && users.length === 0),
    hasData: users.length > 0,
    hasMore: Boolean(query.hasNextPage),
    fetchNextPage: () => { void query.fetchNextPage(); },
    refetch: () => { void query.refetch(); },
  };
}
