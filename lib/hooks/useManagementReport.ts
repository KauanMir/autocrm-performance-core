// lib/hooks/useManagementReport.ts — KPI-REPORTS-B2-EXEC-FRONTEND.
// Leitura do relatório gerencial (get_company_management_report). Mesmo
// padrão estrutural de useCompanySellerLeaderboard: identidade + período
// vêm por parâmetro, useQuery SEMPRE chamado na mesma ordem (Rules of
// Hooks), `enabled` fazendo o gating.
//
// DIFERENÇA CRÍTICA em relação ao Pódio (§2/§52 do EXEC): Seller NÃO
// recebe este dashboard. `isAuthorizedRole` só é true para Manager (na
// própria empresa) ou Super Admin contextual (empresa explícita) — um
// Seller nunca habilita a query, então a RPC NUNCA é chamada para ele,
// mesmo que a tela seja montada por engano. A segurança real continua no
// backend (o gate de relatório gerencial dentro da RPC nega Seller com
// 42501), este é o gate de PRODUTO/rollout no cliente.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import type { ResolvedPeriod } from '@/lib/date/companyPeriod';
import { fetchManagementReport } from '@/lib/managementReport/repository';
import { isManagementReportError } from '@/lib/managementReport/errors';
import { managementReportQueryKey } from '@/lib/managementReport/queryKeys';
import type { ManagementReport } from '@/lib/managementReport/types';

export type ManagementReportState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  // A RPC respondeu, mas o JSON violou o contrato congelado — estado de
  // erro honesto, nunca números fabricados (§6).
  | { status: 'contract-error'; retry: () => void }
  | { status: 'ready'; report: ManagementReport };

export type UseManagementReportOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
  period: ResolvedPeriod;
  // true SOMENTE quando companyId vem de um OperationalCompanyContext em
  // modo super_admin. Bypassa a exigência de membershipRole==='manager' E
  // faz a RPC receber p_company_id explícito.
  isSuperAdminContext?: boolean;
};

const DISABLED_QUERY_KEY = ['company', null, 'management-report', 'remote', null, null, null] as const;

export function useManagementReport(
  options: UseManagementReportOptions,
): ManagementReportState {
  const { userId, companyId, membershipRole, userIsActive, period, isSuperAdminContext = false } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  // Seller NUNCA passa (mesmo com membership ativa na empresa).
  const isAuthorizedRole = membershipRole === 'manager' || isSuperAdminContext;
  const periodReady = period.kind === 'ready';

  const queryEnabled =
    remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isAuthorizedRole && periodReady;

  const queryKey = hasCompany && hasUser && periodReady
    ? managementReportQueryKey(companyId as string, userId as string, period.startMillis, period.endMillis)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Seller, sem empresa ou período ainda não
  // resolvido => enabled=false, zero chamadas) — mesma garantia dos hooks
  // irmãos.
  const query = useQuery<ManagementReport>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchManagementReport({
      periodStartMillis: (period as { startMillis: number }).startMillis,
      periodEndMillis: (period as { endMillis: number }).endMillis,
      companyId: isSuperAdminContext ? (companyId ?? undefined) : undefined,
    }),
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (period.kind === 'loading') return { status: 'loading' };
  if (period.kind === 'unavailable') return { status: 'unavailable' };
  if (period.kind === 'error') return { status: 'error', retry: period.retry };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) {
    if (isManagementReportError(query.error) && query.error.code === 'management_report_contract_invalid') {
      return { status: 'contract-error', retry: query.refetch };
    }
    return { status: 'error', retry: query.refetch };
  }
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', report: query.data };
}
