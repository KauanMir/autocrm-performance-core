// lib/podium/competitionCelebration.ts — PODIUM-COMPETITION-R2B/R2C-B1-EXEC
// + COMPETITION-RANKUP-FEEDBACK-V1-EXEC. Puro: sem React, sem rede —
// transforma um evento real (seller_competition_events, já lido via
// list_my_unseen_competition_events) em copy pronta para a comemoração e
// resolve, a partir do overview de premiação já existente, o prêmio da
// NOVA posição.
//
// Fatos persistidos (old_rank/new_rank/sale_count/related_seller/
// competition_started/sourceType), nunca texto pronto no banco (§20 do
// R2B) — só este helper decide a frase, então mudar copy nunca precisa de
// migration. ZERO copy negativa (§26 do R2B / §23 do RANKUP): este helper
// só é chamado para eventos que já passaram pelo filtro de melhora real
// (nunca "caiu"/"perdeu"/"ultrapassado por"). ZERO em dash (§27 do R2B).
//
// COMPETITION-RANKUP-FEEDBACK-V1 §7/§8 — para uma VENDA que melhorou a
// posição a copy passa a ser escolhida pela NOVA posição (1º / 2º / pódio /
// genérico), com "Você subiu N posições" só quando N > 1. Visit e
// Agendamento (§2) continuam com a copy anterior, intacta.
//
// sourceType (R2C §27 + COMPETITION-V2-B2-EXEC §15/§16): a causa real do
// avanço nunca é atribuída errada. source='sale' fala de venda;
// source='visit' fala de "visita realizada"; source='appointment' fala de
// "agendamento" (a visita foi só GERADA, ainda não realizada — §16 pede
// diferenciação clara). competitionStarted é sempre false para 'visit' e
// 'appointment' (garantido pelo backend — nunca "a primeira venda do
// mês"), então esse branch permanece Sale-only por construção.
import type { UnseenCompetitionEvent } from '@/lib/podium/competitionEventsRepository';
import type { RewardsOverview } from '@/lib/competitionRewards/homeTypes';
import { firstName } from '@/lib/podium/competition';

export interface CompetitionCelebrationCopy {
  eyebrow: string;
  headline: string;
  message: string;
}

// COMPETITION-RANKUP-FEEDBACK-V1 §7/§8 — copy da comemoração pós-VENDA,
// escolhida pela NOVA posição no ranking. Só é alcançada para
// source_type='sale' fora do caso competition_started.
function buildSaleRankAdvanceCopy(event: UnseenCompetitionEvent): CompetitionCelebrationCopy {
  const n = event.newRank;
  const gained = event.oldRank - event.newRank; // > 0 garantido pelo filtro de melhora real
  const multi = gained > 1;
  // §8 — "Você subiu N posições" só quando N > 1; avanço de 1 não polui.
  const jumpClause = multi ? `Você subiu ${gained} posições e ` : '';

  if (n === 1) {
    const rival = event.relatedSellerLabel ? firstName(event.relatedSellerLabel) : null;
    return {
      eyebrow: 'VOCÊ ASSUMIU A LIDERANÇA',
      headline: 'Você assumiu a liderança! 🏆',
      message: rival
        ? `Você ultrapassou ${rival} e assumiu a liderança.`
        : multi
          ? `Você subiu ${gained} posições e assumiu a liderança.`
          : 'Agora você é o 1º colocado.',
    };
  }

  if (n === 2) {
    return {
      eyebrow: 'VOCÊ ASSUMIU O 2º LUGAR',
      headline: 'Você assumiu o 2º lugar!',
      message: multi
        ? `Você subiu ${gained} posições. A liderança está logo ali.`
        : 'A liderança está logo ali.',
    };
  }

  if (n === 3) {
    return {
      eyebrow: 'VOCÊ CHEGOU AO PÓDIO',
      headline: 'Você chegou ao pódio! 🏆',
      message: multi ? `${jumpClause}agora está em 3º lugar.` : 'Agora você está em 3º lugar.',
    };
  }

  return {
    eyebrow: 'VOCÊ SUBIU NO RANKING',
    headline: 'Você subiu no ranking! 🚀',
    message: multi ? `${jumpClause}agora está em ${n}º lugar.` : `Agora você está em ${n}º lugar.`,
  };
}

// R2C §27-§31 — copy para avanços causados por Visit realizada ou por um
// novo Agendamento. Intacta desde o R2C: o RANKUP-FEEDBACK-V1 (§2) não
// mexe nesta experiência.
function buildActivityRankAdvanceCopy(event: UnseenCompetitionEvent): CompetitionCelebrationCopy {
  const isAppointment = event.sourceType === 'appointment';

  // Frase que atribui a CAUSA real do avanço (§16 — nunca misturar os
  // motivos): visita realizada / novo agendamento.
  const causeToRank = (rankLabel: string): string =>
    isAppointment
      ? `Seu novo agendamento levou você ao ${rankLabel}.`
      : `Sua visita realizada levou você ao ${rankLabel}.`;

  if (event.newRank === 1) {
    const rival = event.relatedSellerLabel ? firstName(event.relatedSellerLabel) : null;
    return {
      eyebrow: 'VOCÊ ASSUMIU A LIDERANÇA',
      headline: 'Parabéns!',
      message: rival
        ? `Você ultrapassou ${rival} e assumiu o 1º lugar.`
        : isAppointment
          ? 'Seu novo agendamento levou você ao 1º lugar.'
          : 'Você concluiu uma visita e assumiu o 1º lugar.',
    };
  }

  if (event.oldRank > 3 && event.newRank <= 3) {
    return {
      eyebrow: 'VOCÊ ENTROU NO TOP 3',
      headline: 'Você entrou no Top 3!',
      message: causeToRank(`${event.newRank}º lugar`),
    };
  }

  const positionsGained = event.oldRank - event.newRank;
  return {
    eyebrow: 'VOCÊ SUBIU NO RANKING',
    headline: positionsGained === 1 ? 'Você ganhou 1 posição!' : `Você ganhou ${positionsGained} posições!`,
    message: causeToRank(`${event.newRank}º lugar`),
  };
}

// §25 do R2B — casos, em ordem de prioridade de seleção da MENSAGEM (não
// confundir com a prioridade de escolha do evento principal quando há
// vários unseen, ver selectPrimaryCompetitionEvent abaixo).
export function buildCompetitionCelebration(event: UnseenCompetitionEvent): CompetitionCelebrationCopy {
  // §24 do RANKUP — primeira venda do mês abre a disputa; semântica
  // existente preservada, nunca "subiu de 0º para 1º".
  if (event.competitionStarted) {
    return {
      eyebrow: 'PRIMEIRA VENDA DO MÊS',
      headline: 'Primeira venda do mês!',
      message: 'Você abriu a disputa e assumiu a liderança.',
    };
  }

  return event.sourceType === 'sale'
    ? buildSaleRankAdvanceCopy(event)
    : buildActivityRankAdvanceCopy(event);
}

// ── COMPETITION-RANKUP-FEEDBACK-V1 §9-§12/§19/§26 — prêmio da nova posição
// derivado do overview de premiação JÁ existente (get_competition_rewards_
// overview via useCompetitionRewardsOverview). NUNCA consulta reward tables
// direto; NUNCA reconstrói prêmio de snapshot passado. Puro/testável.
export interface CelebrationRewardRef {
  amountCents: number | null;
  rewardText: string | null;
}

export interface CelebrationRewardContext {
  // §9 — prêmio do tier correspondente à NOVA posição. null quando não há
  // campanha publicada OU não há tier para essa posição (§10 — nunca
  // "R$ 0"/"sem prêmio").
  positionReward: CelebrationRewardRef | null;
  // §11 — "1º lugar vale X"; só quando a nova posição não é a 1ª (quem
  // chegou em 1º já vê o próprio prêmio em positionReward).
  firstPlaceReward: CelebrationRewardRef | null;
}

const EMPTY_CELEBRATION_REWARD: CelebrationRewardContext = {
  positionReward: null,
  firstPlaceReward: null,
};

function hasRewardValue(amountCents: number | null, rewardText: string | null): boolean {
  return (amountCents !== null && amountCents > 0) || (rewardText?.trim() ?? '') !== '';
}

export function resolveCelebrationReward(
  overview: RewardsOverview | null,
  newRank: number,
): CelebrationRewardContext {
  if (!overview) return EMPTY_CELEBRATION_REWARD;
  // §4/§26 — só campanha PUBLICADA do mês ATUAL vira prêmio na comemoração
  // (o overview só devolve `published` para Seller; o guard cobre os demais
  // papéis por segurança).
  const campaign =
    overview.campaign && overview.campaign.status === 'published' ? overview.campaign : null;
  if (!campaign) return EMPTY_CELEBRATION_REWARD;

  const tier = campaign.tiers.find((t) => t.position === newRank) ?? null;
  const positionReward =
    tier && hasRewardValue(tier.amountCents, tier.rewardText)
      ? { amountCents: tier.amountCents, rewardText: tier.rewardText }
      : null;

  const fp = overview.firstPlaceReward;
  const firstPlaceReward =
    newRank !== 1 && fp && hasRewardValue(fp.amountCents, fp.rewardText)
      ? { amountCents: fp.amountCents, rewardText: fp.rewardText }
      : null;

  return { positionReward, firstPlaceReward };
}

// §24 do R2B — quando há vários eventos unseen ao mesmo tempo (ex.:
// Manager registrou várias vendas enquanto o Seller estava offline), nunca
// abre um modal por evento: escolhe UM principal por prioridade conceitual
// (competition_started > assumiu 1º > entrou Top 3 > mais posições ganhas
// > mais recente) — os demais são marcados como vistos junto (decisão do
// caller, não deste helper).
export function selectPrimaryCompetitionEvent(
  events: readonly UnseenCompetitionEvent[],
): UnseenCompetitionEvent | null {
  // §3/§23/§31 do RANKUP — comemoração só para MELHORA real de posição (ou
  // a primeira venda do mês, que abre a disputa). O backend já só emite
  // eventos de avanço, mas um 4→4 / 3→4 acidental nunca vira celebração.
  const advances = events.filter((e) => e.competitionStarted || e.newRank < e.oldRank);
  if (advances.length === 0) return null;

  function priority(e: UnseenCompetitionEvent): number {
    if (e.competitionStarted) return 4;
    if (e.newRank === 1) return 3;
    if (e.oldRank > 3 && e.newRank <= 3) return 2;
    return 1;
  }

  let best = advances[0];
  let bestPriority = priority(best);
  for (const e of advances.slice(1)) {
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
