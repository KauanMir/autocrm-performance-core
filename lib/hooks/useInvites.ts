// lib/hooks/useInvites.ts — leitura da listagem administrativa de convites
// (M1-F S4-F1). Mesmo molde de lib/hooks/useCompanies.ts: identidade e
// autorização vêm por parâmetro (o componente resolve currentUser +
// canManageInvites + o escopo) — este hook não importa AuthService nem
// lib/capabilities. Rules of Hooks: useQuery é chamado SEMPRE, na mesma
// ordem, com `enabled` fazendo o gating.
//
// Segurança: nenhuma escolha de autorização acontece aqui — só gating de
// REQUISIÇÃO. A RLS (invites_select_own_or_platform) + o GRANT por coluna
// (S4-F1) são a autoridade real. `scope` é sempre explícito, fornecido
// pelo chamador (nunca inferido de localStorage/estado global) — ver
// AdminInviteScope em lib/invites/queryKeys.ts.
import { useQuery } from '@tanstack/react-query';
import { adminInviteQueryKeys, type AdminInviteScope } from '@/lib/invites/queryKeys';
import { fetchInvites, type AdminInviteListItem } from '@/lib/invites/repository';

export type UseInvitesOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: canManageInvites(currentUser). Este hook não
  // decide autorização, só usa o resultado para o gating.
  authorized: boolean;
  // null quando o escopo ainda não pode ser determinado (ex.: Manager sem
  // membership ativa resolvida, ou nenhum escopo aplicável) — a query fica
  // desabilitada nesse caso, nunca assume um escopo implícito.
  scope: AdminInviteScope | null;
};

export type UseInvitesResult = {
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  invites: readonly AdminInviteListItem[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há userId/scope válidos ou o
// chamador não está autorizado (enabled=false, zero requests) — o segundo
// segmento nunca é uma string real, então nunca colide com o cache de
// nenhuma identidade/escopo real.
const DISABLED_INVITES_QUERY_KEY = ['admin-invites', null, 'disabled'] as const;

const EMPTY_INVITES: readonly AdminInviteListItem[] = Object.freeze([]);

export function useInvites(options: UseInvitesOptions): UseInvitesResult {
  const { userId, authorized, scope } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';

  const queryEnabled = authorized && hasUser && scope !== null;
  const queryKey = hasUser && scope !== null
    ? adminInviteQueryKeys.list(userId as string, scope)
    : DISABLED_INVITES_QUERY_KEY;

  // Declarada SEMPRE (não autorizado/sem escopo ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders.
  const query = useQuery<AdminInviteListItem[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchInvites(scope as AdminInviteScope),
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
    queryKey,
    invites: data ?? EMPTY_INVITES,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
