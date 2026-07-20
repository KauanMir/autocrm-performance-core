// lib/hooks/useCompanies.ts — leitura da listagem administrativa de
// companies (M1-F S3-B). Identidade e autorização vêm por parâmetro (o
// componente resolve o usuário ativo e a combinação flag×platformRole) —
// este hook não importa AuthService nem lib/flags. Rules of Hooks: useQuery
// é chamado SEMPRE, na mesma ordem, com `enabled` fazendo o gating.
//
// Segurança: nenhum filtro de usuário/empresa é enviado ao Supabase — a RLS
// (companies_select_accessible) é a autoridade de isolamento; userId
// aparece apenas na query key, para particionar o cache por identidade.
import { useQuery } from '@tanstack/react-query';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { fetchAccessibleCompanies, type PlatformCompanyRow } from '@/lib/companies/repository';

export type UseCompaniesOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: flag ON && platformRole === 'super_admin'.
  // Este hook não decide autorização, só usa o resultado para o gating.
  authorized: boolean;
};

export type UseCompaniesResult = {
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  companies: readonly PlatformCompanyRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há userId válido ou o chamador não
// está autorizado (enabled=false, zero requests) — o segundo segmento nunca
// é uma string real, então nunca colide com o cache de nenhuma identidade.
const DISABLED_COMPANIES_QUERY_KEY = ['platform-admin', null, 'companies', 'disabled'] as const;

const EMPTY_COMPANIES: readonly PlatformCompanyRow[] = Object.freeze([]);

export function useCompanies(options: UseCompaniesOptions): UseCompaniesResult {
  const { userId, authorized } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';

  const queryEnabled = authorized && hasUser;
  const queryKey = hasUser
    ? platformCompanyQueryKeys.list(userId as string)
    : DISABLED_COMPANIES_QUERY_KEY;

  // Declarada SEMPRE (não autorizado/flag OFF ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders.
  const query = useQuery<PlatformCompanyRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchAccessibleCompanies,
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
    queryKey,
    companies: data ?? EMPTY_COMPANIES,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(data && data.length === 0),
    hasData: Boolean(data && data.length > 0),
    refetch: query.refetch,
  };
}
