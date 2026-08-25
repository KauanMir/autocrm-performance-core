// lib/hooks/useCompanySellerLeaderboard.ts — PODIUM-COMPETITION-R1-EXEC.
// Leitura do leaderboard company-wide real (list_company_seller_
// leaderboard). Mesmo padrão estrutural de useCurrentCompanyTimezone/
// useActiveCompanyIdentity: identidade + período vêm por parâmetro, useQuery
// SEMPRE chamado na mesma ordem (Rules of Hooks), `enabled` fazendo o
// gating. Manager e Seller recebem exatamente a mesma query/mesmo shape —
// a RPC já devolve o roster inteiro da empresa para os dois papéis, nunca
// um filtro adicional aqui.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import type { ResolvedPeriod } from '@/lib/date/companyPeriod';
import {
  fetchCompanySellerLeaderboard,
  type CompanySellerLeaderboardRow,
} from '@/lib/podium/leaderboardRepository';

export type CompanySellerLeaderboardState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  // §16 do EXEC: empresa sem NENHUMA venda no período — roster real existe
  // (sellerCount vem dele, nunca inventado), mas nenhum Top 3/ranking
  // artificial é montado.
  | { status: 'empty'; sellerCount: number }
  | { status: 'ready'; rows: readonly CompanySellerLeaderboardRow[] };

export type UseCompanySellerLeaderboardOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
  period: ResolvedPeriod;
  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — true SOMENTE quando companyId vem
  // de um OperationalCompanyContext em modo super_admin. Bypassa a exigência
  // de membershipRole E faz a RPC receber p_company_id explícito (o backend
  // já suporta isso via can_access_company, ver
  // 20260825120000_podium_competition_leaderboard_r1.sql) — Manager/Seller
  // continuam SEM enviar p_company_id (a RPC deriva da própria membership,
  // comportamento 100% preservado).
  isSuperAdminContext?: boolean;
};

const DISABLED_QUERY_KEY = ['company', null, 'seller-leaderboard', 'remote', null, null, null] as const;

export function companySellerLeaderboardQueryKey(
  companyId: string,
  userId: string,
  periodStartMillis: number,
  periodEndMillis: number,
) {
  return ['company', companyId, 'seller-leaderboard', 'remote', userId, periodStartMillis, periodEndMillis] as const;
}

// PODIUM-COMPETITION-R2B-B1-EXEC §33 — prefixo estável (sem userId/período)
// para invalidar TODO o leaderboard de uma empresa de uma vez (ex.: depois
// de registerSale, sem saber qual período/usuário está com cache quente
// no momento) — invalidateQueries faz match por prefixo por padrão.
export function companySellerLeaderboardQueryPrefix(companyId: string) {
  return ['company', companyId, 'seller-leaderboard', 'remote'] as const;
}

export function useCompanySellerLeaderboard(
  options: UseCompanySellerLeaderboardOptions,
): CompanySellerLeaderboardState {
  const { userId, companyId, membershipRole, userIsActive, period, isSuperAdminContext = false } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller' || isSuperAdminContext;
  const periodReady = period.kind === 'ready';

  const queryEnabled =
    remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller && periodReady;

  const queryKey = hasCompany && hasUser && periodReady
    ? companySellerLeaderboardQueryKey(companyId, userId, period.startMillis, period.endMillis)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Super Admin, sem membership ou período
  // ainda não resolvido ⇒ enabled=false, zero chamadas) — mesma garantia
  // de useCurrentCompanyTimezone/useActiveCompanyIdentity.
  const query = useQuery<CompanySellerLeaderboardRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchCompanySellerLeaderboard({
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
  if (query.isError) return { status: 'error', retry: query.refetch };

  const rows = query.data ?? [];
  if (rows.length > 0 && rows.every((row) => row.saleCount === 0)) {
    return { status: 'empty', sellerCount: rows.length };
  }
  return { status: 'ready', rows };
}
