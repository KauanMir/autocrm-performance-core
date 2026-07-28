// lib/hooks/useCommercialCompanies.ts — leitura de list_commercial_companies
// (M1-F S8-C2-B2). Identidade e autorização vêm por parâmetro (o componente
// resolve platformRole + a flag NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ) —
// este hook não importa AuthService nem lib/flags. Rules of Hooks: useQuery é
// chamado SEMPRE, na mesma ordem, com `enabled` fazendo o gating.
//
// Dataset PRÓPRIO (inclui 'cancelada') — nunca reaproveita useCompanies/
// fetchAccessibleCompanies (aquele exclui 'cancelada' por design, serve a
// tela administrativa ScreenEmpresas, dataset diferente). A RPC já valida
// is_platform_super_admin() internamente; nenhum filtro é enviado daqui.
import { useQuery } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { fetchCommercialCompanies, type CommercialCompanyRow } from '@/lib/commercial/repository';

export type UseCommercialCompaniesOptions = {
  userId?: string | null;
  // Resolvido pelo chamador: platformRole === 'super_admin' &&
  // isSuperAdminCommercialReadEnabled(). Este hook não decide autorização.
  authorized: boolean;
};

export type UseCommercialCompaniesResult = {
  queryEnabled: boolean;
  companies: readonly CommercialCompanyRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const DISABLED_QUERY_KEY = ['platform-commercial', null, 'companies', 'disabled'] as const;
const EMPTY_COMPANIES: readonly CommercialCompanyRow[] = Object.freeze([]);

export function useCommercialCompanies(
  options: UseCommercialCompaniesOptions,
): UseCommercialCompaniesResult {
  const { userId, authorized } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const queryEnabled = authorized && hasUser;
  const queryKey = hasUser
    ? platformCommercialQueryKeys.companies(userId as string)
    : DISABLED_QUERY_KEY;

  const query = useQuery<CommercialCompanyRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchCommercialCompanies,
  });

  const data = query.data ?? null;

  return {
    queryEnabled,
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
