// lib/podium/competitionCelebration.ts — PODIUM-COMPETITION-R2B/R2C-B1-EXEC
// §25/§26/§27 (R2B) + §27-§31 (R2C). Puro: sem React, sem rede —
// transforma um evento real (seller_competition_events, já lido via
// list_my_unseen_competition_events) em copy pronta para a comemoração.
// Fatos persistidos (old_rank/new_rank/sale_count/related_seller/
// competition_started/sourceType), nunca texto pronto no banco (§20 do
// R2B) — só este helper decide a frase, então mudar copy nunca precisa de
// migration.
//
// ZERO copy negativa (§26 do R2B): este helper só é chamado para eventos
// que já passaram pelo filtro de melhora real dentro de register_sale/
// register_visit_result (nunca "caiu"/"perdeu"/"ultrapassado por"). ZERO
// em dash (§27 do R2B).
//
// sourceType (R2C §27): eventos causados por Visit NUNCA atribuem o
// avanço a uma venda — "com N vendas" (métrica de conquista real, mas
// mecanismo de venda) só aparece em eventos source='sale'; eventos
// source='visit' descrevem a visita concluída como a causa real.
// competitionStarted é sempre false para source='visit' (garantido pelo
// backend — não existe "primeira venda do mês" causada por uma Visit),
// então esse branch permanece Sale-only por construção.
import type { UnseenCompetitionEvent } from '@/lib/podium/competitionEventsRepository';
import { firstName, vendaWord } from '@/lib/podium/competition';

export interface CompetitionCelebrationCopy {
  eyebrow: string;
  headline: string;
  message: string;
}

// §25 do EXEC — casos, em ordem de prioridade de seleção da MENSAGEM (não
// confundir com a prioridade de escolha do evento principal quando há
// vários unseen, ver selectPrimaryCompetitionEvent abaixo).
export function buildCompetitionCelebration(event: UnseenCompetitionEvent): CompetitionCelebrationCopy {
  const isVisit = event.sourceType === 'visit';

  if (event.competitionStarted) {
    return {
      eyebrow: 'PRIMEIRA VENDA DO MÊS',
      headline: 'Primeira venda do mês!',
      message: 'Você abriu a disputa e assumiu a liderança.',
    };
  }

  if (event.newRank === 1) {
    const rival = event.relatedSellerLabel ? firstName(event.relatedSellerLabel) : null;
    return {
      eyebrow: 'VOCÊ ASSUMIU A LIDERANÇA',
      headline: 'Parabéns!',
      message: rival
        ? `Você ultrapassou ${rival} e assumiu o 1º lugar.`
        : isVisit
          ? 'Você concluiu uma visita e assumiu o 1º lugar.'
          : `Você assumiu o 1º lugar com ${vendaWord(event.saleCount)}.`,
    };
  }

  if (event.oldRank > 3 && event.newRank <= 3) {
    return {
      eyebrow: 'VOCÊ ENTROU NO TOP 3',
      headline: 'Você entrou no Top 3!',
      message: isVisit
        ? `Sua visita realizada levou você ao ${event.newRank}º lugar.`
        : `Agora você está em ${event.newRank}º lugar com ${vendaWord(event.saleCount)}.`,
    };
  }

  const positionsGained = event.oldRank - event.newRank;
  return {
    eyebrow: 'VOCÊ SUBIU NO RANKING',
    headline: positionsGained === 1 ? 'Você ganhou 1 posição!' : `Você ganhou ${positionsGained} posições!`,
    message: isVisit
      ? `Sua visita realizada levou você ao ${event.newRank}º lugar.`
      : `Agora você está em ${event.newRank}º lugar.`,
  };
}

// §24 do EXEC — quando há vários eventos unseen ao mesmo tempo (ex.:
// Manager registrou várias vendas enquanto o Seller estava offline), nunca
// abre um modal por evento: escolhe UM principal por prioridade conceitual
// (competition_started > assumiu 1º > entrou Top 3 > mais posições ganhas
// > mais recente) — os demais são marcados como vistos junto (decisão do
// caller, não deste helper).
export function selectPrimaryCompetitionEvent(
  events: readonly UnseenCompetitionEvent[],
): UnseenCompetitionEvent | null {
  if (events.length === 0) return null;

  function priority(e: UnseenCompetitionEvent): number {
    if (e.competitionStarted) return 4;
    if (e.newRank === 1) return 3;
    if (e.oldRank > 3 && e.newRank <= 3) return 2;
    return 1;
  }

  let best = events[0];
  let bestPriority = priority(best);
  for (const e of events.slice(1)) {
    const p = priority(e);
    const better =
      p > bestPriority ||
      (p === bestPriority && e.oldRank - e.newRank > best.oldRank - best.newRank) ||
      (p === bestPriority && e.oldRank - e.newRank === best.oldRank - best.newRank && e.createdAt > best.createdAt);
    if (better) {
      best = e;
      bestPriority = p;
    }
  }
  return best;
}
