// lib/hooks/useCurrentCompanyTimezone.ts — HOME-FILTERS-R1-EXEC. Resolve o
// timezone REAL da empresa ativa (companies.timezone) para ancorar os
// boundaries do filtro de período do Pódio — nunca o timezone do navegador,
// nunca um fallback hardcoded (A1-PRECHECK §6/§13).
//
// Reaproveita fetchAccessibleCompanies (lib/companies/repository.ts), a
// MESMA leitura já usada pela listagem administrativa de Super Admin (RLS
// companies_select_accessible / can_access_company) — nenhuma RPC nova,
// nenhuma tabela nova, nenhum SELECT novo. Para Manager/Seller a RLS já
// devolve no máximo a própria empresa (mesma autoridade que já gateia
// Leads/Tasks/Visits/Deals/Sales); este hook só filtra pelo companyId
// ativo, nunca amplia o que a RLS entrega. `authorized` de useCompanies
// (M1-F S3-B) é um gate de PRODUTO específico da tela administrativa, não
// uma exigência de segurança — a segurança já é 100% RLS, então reusar a
// mesma repository function para Manager/Seller aqui é seguro por
// construção.
//
// Mesmo padrão exato de useCurrentCompanySellerLabels: identidade por
// parâmetro, useQuery SEMPRE chamado na mesma ordem (Rules of Hooks),
// `enabled` fazendo o gating, gate mestre isRemoteLeadsEnabled() (mesmo
// flag que já gateia toda a Home remota).
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import { fetchAccessibleCompanies } from '@/lib/companies/repository';

export type HomeCompanyTimezone =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; timezone: string };

export type UseCurrentCompanyTimezoneOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

// Key sentinela usada SOMENTE quando a query está desabilitada — nunca
// colide com uma key real (mesmo padrão de useCurrentCompanySellerLabels).
const DISABLED_QUERY_KEY = ['company', null, 'timezone', 'remote', null] as const;

export function useCurrentCompanyTimezone(options: UseCurrentCompanyTimezoneOptions): HomeCompanyTimezone {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled = remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller;
  const queryKey = hasCompany && hasUser
    ? (['company', companyId, 'timezone', 'remote', userId] as const)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Super Admin ou sem membership ⇒
  // enabled=false, zero chamadas) — mesma garantia de useCurrentCompanySellerLabels.
  const query = useQuery({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchAccessibleCompanies,
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };

  const row = (query.data ?? []).find((c) => c.id === companyId);
  if (!row || typeof row.timezone !== 'string' || row.timezone.trim() === '') {
    return { status: 'unavailable' };
  }
  return { status: 'ready', timezone: row.timezone };
}
