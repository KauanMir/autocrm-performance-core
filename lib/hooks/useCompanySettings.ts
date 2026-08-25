// lib/hooks/useCompanySettings.ts — COMPANY-SETTINGS-R1-EXEC. Leitura da
// empresa real para Ajustes > Empresa. Reaproveita fetchAccessibleCompanies
// (lib/companies/repository.ts) — MESMA fonte já usada por useCompanies
// (Super Admin/Empresas) e useCurrentCompanyTimezone (Pódio); nenhum SELECT
// novo, nenhuma RPC de leitura nova.
//
// Parametrizado por companyId EXPLÍCITO (nunca "descoberto" internamente a
// partir de activeMembership) — PRECHECK §13: o chamador resolve companyId
// (Manager: currentUser.activeMembership.companyId) e `authorized`
// (canManageCompanySettings), este hook só usa o que recebe. Isso prepara o
// futuro "Super Admin escolhe empresa" sem exigir reescrever o hook — só um
// companyId diferente chega por parâmetro.
import { useQuery } from '@tanstack/react-query';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { fetchAccessibleCompanies, type PlatformCompanyRow } from '@/lib/companies/repository';

export type CompanySettingsState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; company: PlatformCompanyRow };

export type UseCompanySettingsOptions = {
  userId?: string | null;
  companyId?: string | null;
  // Resolvido pelo chamador: canManageCompanySettings(currentUser) — este
  // hook não decide autorização, só usa o resultado para o gating (mesmo
  // contrato de UseCompaniesOptions.authorized).
  authorized: boolean;
};

// Key sentinela usada SOMENTE quando a query está desabilitada — nunca
// colide com uma key real (mesmo padrão de useCompanies/useCurrentCompanyTimezone).
const DISABLED_QUERY_KEY = ['company-settings', null, null] as const;

export function useCompanySettings(options: UseCompanySettingsOptions): CompanySettingsState {
  const { userId, companyId, authorized } = options;
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';

  const queryEnabled = authorized && hasUser && hasCompany;
  const queryKey = hasUser && hasCompany
    ? platformCompanyQueryKeys.detail(companyId as string, userId as string)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (não autorizado/sem empresa ⇒ enabled=false, zero
  // chamadas) — mesma garantia de useCompanies/useCurrentCompanyTimezone.
  const query = useQuery<PlatformCompanyRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchAccessibleCompanies,
  });

  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };

  const row = (query.data ?? []).find((c) => c.id === companyId);
  if (!row) return { status: 'unavailable' };
  return { status: 'ready', company: row };
}
