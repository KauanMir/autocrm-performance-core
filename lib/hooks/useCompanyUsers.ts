// lib/hooks/useCompanyUsers.ts — leitura paginada da listagem administrativa
// de usuários ativos (M1-F S5-D). Identidade e autorização vêm por
// parâmetro (o componente resolve currentUser + capability + o escopo) —
// este hook não importa AuthService nem lib/capabilities. Rules of Hooks:
// useInfiniteQuery é chamado SEMPRE, na mesma ordem, com `enabled` fazendo
// o gating.
//
// Paginação: list_company_users nunca devolve has_more/total_count (§22.5 —
// "a existência de próxima página só é confirmada pela chamada seguinte").
// useInfiniteQuery é o encaixe natural desse contrato: getNextPageParam
// retorna undefined assim que uma página vier com MENOS linhas que o limite
// (fim da lista OU a "chamada seguinte vazia" já esperada) — nenhuma página
// vazia é descartada das anteriores (query.data.pages só cresce, nunca
// encolhe), então "carregar mais" nunca apaga itens já exibidos. Trocar
// scope/role/search muda a query key inteira, o que reinicia páginas e
// cursor automaticamente (nova key = novo estado de paginação do zero) —
// nenhuma lógica extra de reset é necessária.
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  companyUserQueryKeys,
  type CompanyUserRoleFilter,
  type CompanyUserScope,
} from '@/lib/users/queryKeys';
import { fetchCompanyUsers, type CompanyUserCursor, type CompanyUserRow } from '@/lib/users/repository';

export const COMPANY_USERS_DEFAULT_LIMIT = 25;

export type UseCompanyUsersOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: canManageInvites(currentUser) (mesma capability
  // que já gate a aba "Usuários" inteira — Super Admin OU Manager com
  // membership ativa). Este hook não decide autorização, só usa o
  // resultado para o gating.
  authorized: boolean;
  // null quando o escopo ainda não pode ser determinado (ex.: actor nulo) —
  // a query fica desabilitada nesse caso, nunca assume um escopo implícito.
  scope: CompanyUserScope | null;
  role: CompanyUserRoleFilter;
  // Já normalizado/debounced pelo chamador (trim; null = busca desativada).
  search: string | null;
  limit?: number;
};

export type UseCompanyUsersResult = {
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  users: readonly CompanyUserRow[];
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
const DISABLED_COMPANY_USERS_QUERY_KEY = ['company-users', null, 'disabled'] as const;

const EMPTY_USERS: readonly CompanyUserRow[] = Object.freeze([]);

export function useCompanyUsers(options: UseCompanyUsersOptions): UseCompanyUsersResult {
  const { userId, authorized, scope, role, search, limit = COMPANY_USERS_DEFAULT_LIMIT } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';

  const queryEnabled = authorized && hasUser && scope !== null;
  const queryKey = hasUser && scope !== null
    ? companyUserQueryKeys.list(userId as string, scope, role, search)
    : DISABLED_COMPANY_USERS_QUERY_KEY;

  const query = useInfiniteQuery<CompanyUserRow[]>({
    queryKey,
    enabled: queryEnabled,
    initialPageParam: null as CompanyUserCursor | null,
    queryFn: ({ pageParam }) =>
      fetchCompanyUsers({
        limit,
        cursor: pageParam as CompanyUserCursor | null,
        search,
        companyId: scope !== null ? scope.companyId : null,
        role,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < limit) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { createdAt: last.created_at, membershipId: last.membership_id } satisfies CompanyUserCursor;
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
