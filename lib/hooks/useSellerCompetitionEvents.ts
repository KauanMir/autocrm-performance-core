// lib/hooks/useSellerCompetitionEvents.ts — PODIUM-COMPETITION-R2B-B1-EXEC.
// Eventos reais de melhora de ranking ainda não vistos pelo Seller logado
// (list_my_unseen_competition_events). Mesmo padrão estrutural de
// useCompanySellerLeaderboard: identidade por parâmetro, useQuery SEMPRE
// chamado na mesma ordem (Rules of Hooks), `enabled` fazendo o gating.
//
// SOMENTE Seller (§21/§32 do EXEC) — Manager e Super Admin nunca recebem
// comemoração pessoal, então nem chegam a chamar a RPC (a RPC também nega
// no backend — defesa em profundidade, nunca só client-side).
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import {
  fetchUnseenCompetitionEvents,
  type UnseenCompetitionEvent,
} from '@/lib/podium/competitionEventsRepository';

export type SellerCompetitionEventsState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; events: readonly UnseenCompetitionEvent[] };

export type UseSellerCompetitionEventsOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

const DISABLED_QUERY_KEY = ['company', null, 'competition-events', 'unseen', null] as const;

// Exportada para que useRegisterSale/useMarkCompetitionEventsSeen possam
// invalidar EXATAMENTE esta chave (mesmo padrão de
// currentCompanyTimezoneQueryKey/companySellerLeaderboardQueryKey).
export function sellerCompetitionEventsQueryKey(companyId: string, userId: string) {
  return ['company', companyId, 'competition-events', 'unseen', userId] as const;
}

export function useSellerCompetitionEvents(
  options: UseSellerCompetitionEventsOptions,
): SellerCompetitionEventsState {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isSeller = membershipRole === 'seller';

  const queryEnabled = remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isSeller;
  const queryKey = hasCompany && hasUser
    ? sellerCompetitionEventsQueryKey(companyId, userId)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Manager/Super Admin ou sem membership ⇒
  // enabled=false, zero chamadas) — mesma garantia de
  // useCompanySellerLeaderboard/useCurrentCompanyTimezone.
  const query = useQuery<UnseenCompetitionEvent[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchUnseenCompetitionEvents,
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };

  return { status: 'ready', events: query.data ?? [] };
}
