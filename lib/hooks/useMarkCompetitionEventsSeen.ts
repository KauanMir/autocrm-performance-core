// lib/hooks/useMarkCompetitionEventsSeen.ts — PODIUM-COMPETITION-R2B-B1-EXEC.
// Mutation fina sobre mark_competition_events_seen — quem decide QUANDO
// chamar é o caller (§23 do EXEC: só quando o Seller fecha/confirma a
// comemoração, nunca no simples fetch). Invalida a query de unseen events
// no sucesso — próximo fetch (mesma sessão ou outro dispositivo) já não
// traz mais o evento marcado (§17/§36 do EXEC).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markCompetitionEventsSeen } from '@/lib/podium/competitionEventsRepository';
import { sellerCompetitionEventsQueryKey } from '@/lib/hooks/useSellerCompetitionEvents';

export type UseMarkCompetitionEventsSeenOptions = {
  companyId: string | null;
  userId: string | null;
};

export type UseMarkCompetitionEventsSeenResult = {
  markSeen: (eventIds: readonly string[]) => Promise<number>;
  isPending: boolean;
};

export function useMarkCompetitionEventsSeen(
  options: UseMarkCompetitionEventsSeenOptions,
): UseMarkCompetitionEventsSeenResult {
  const { companyId, userId } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (eventIds: readonly string[]) => markCompetitionEventsSeen(eventIds),
    onSuccess: () => {
      if (companyId && userId) {
        queryClient.invalidateQueries({ queryKey: sellerCompetitionEventsQueryKey(companyId, userId) });
      }
    },
  });

  return {
    markSeen: (eventIds: readonly string[]) => mutation.mutateAsync(eventIds),
    isPending: mutation.isPending,
  };
}
