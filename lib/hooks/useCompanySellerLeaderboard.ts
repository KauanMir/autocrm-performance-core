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

export function useCompanySellerLeaderboard(
  options: UseCompanySellerLeaderboardOptions,
): CompanySellerLeaderboardState {
  const { userId, companyId, membershipRole, userIsActive, period } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
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
