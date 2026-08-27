// lib/podium/competitionEventsRepository.ts — PODIUM-COMPETITION-R2B-B1-EXEC.
// Único caminho de leitura/escrita dos eventos reais de melhora de ranking
// (seller_competition_events) — a tabela em si não tem NENHUM grant a
// authenticated (nem SELECT), toda a superfície é via as 2 RPCs
// SECURITY DEFINER abaixo (list_my_unseen_competition_events/
// mark_competition_events_seen). Nunca INSERT/UPDATE client-side.
import { supabase } from '@/lib/supabase/client';
import { PodiumCompetitionEventsError } from '@/lib/podium/errors';

// PODIUM-COMPETITION-R2C-B1-EXEC — sourceType distingue a origem real do
// evento (Sale vs Visit completed) para a celebração nunca atribuir o
// avanço à causa errada (§27 do EXEC — nunca dizer "com esta venda" para
// um evento que na verdade veio de uma Visit).
// COMPETITION-V2-B2-EXEC §14 — terceira origem: 'appointment' (agendamento
// gerado, evento produzido por create_visit). sale/visit intactos.
export type CompetitionEventSourceType = 'sale' | 'visit' | 'appointment';

export interface UnseenCompetitionEvent {
  id: string;
  eventType: string;
  sourceType: CompetitionEventSourceType;
  oldRank: number;
  newRank: number;
  saleCount: number;
  relatedSellerId: string | null;
  relatedSellerLabel: string | null;
  competitionStarted: boolean;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export async function fetchUnseenCompetitionEvents(): Promise<UnseenCompetitionEvent[]> {
  const { data, error } = await supabase.rpc('list_my_unseen_competition_events');

  if (error) {
    throw new PodiumCompetitionEventsError('competition_events_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    sourceType: row.source_type === 'visit'
      ? 'visit'
      : row.source_type === 'appointment'
        ? 'appointment'
        : 'sale',
    oldRank: row.old_rank,
    newRank: row.new_rank,
    saleCount: row.sale_count,
    relatedSellerId: row.related_seller_id ?? null,
    relatedSellerLabel: row.related_seller_label ?? null,
    competitionStarted: row.competition_started,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
  }));
}

// §22/§23 do EXEC — chamada SOMENTE quando o Seller efetivamente fecha/
// confirma a comemoração (nunca no simples fetch) — quem decide QUANDO
// chamar é o caller (hook/componente), nunca esta função.
export async function markCompetitionEventsSeen(eventIds: readonly string[]): Promise<number> {
  if (eventIds.length === 0) return 0;

  const { data, error } = await supabase.rpc('mark_competition_events_seen', {
    p_event_ids: [...eventIds],
  });

  if (error) {
    throw new PodiumCompetitionEventsError('competition_events_mark_seen_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return data ?? 0;
}
