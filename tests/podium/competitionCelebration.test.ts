// Testes de lib/podium/competitionCelebration.ts
// (PODIUM-COMPETITION-R2B-B1-EXEC §44 + COMPETITION-RANKUP-FEEDBACK-V1-EXEC
// §29-§32). Puro: sem React, sem rede.
import { describe, expect, it } from 'vitest';
import {
  buildCompetitionCelebration,
  selectPrimaryCompetitionEvent,
  resolveCelebrationReward,
} from '@/lib/podium/competitionCelebration';
import type { UnseenCompetitionEvent } from '@/lib/podium/competitionEventsRepository';
import type { RewardsOverview } from '@/lib/competitionRewards/homeTypes';

function event(over: Partial<UnseenCompetitionEvent> = {}): UnseenCompetitionEvent {
  return {
    id: 'evt-1',
    eventType: 'rank_up',
    sourceType: 'sale',
    oldRank: 4,
    newRank: 3,
    saleCount: 3,
    relatedSellerId: null,
    relatedSellerLabel: null,
    competitionStarted: false,
    periodStart: '2026-08-01T00:00:00-03:00',
    periodEnd: '2026-09-01T00:00:00-03:00',
    createdAt: '2026-08-10T12:00:00Z',
    ...over,
  };
}

describe('buildCompetitionCelebration — competition_started', () => {
  it('primeira venda do mes: copy fixa, nunca "ganhou N posicoes"', () => {
    const copy = buildCompetitionCelebration(event({ competitionStarted: true, oldRank: 3, newRank: 1 }));
    expect(copy.headline).toBe('Primeira venda do mês!');
    expect(copy.message).toBe('Você abriu a disputa e assumiu a liderança.');
    expect(copy.message).not.toMatch(/posições|posição/);
  });
});

// COMPETITION-RANKUP-FEEDBACK-V1-EXEC §7 — a copy de uma VENDA que melhorou
// a posição é escolhida pela NOVA colocação. §8 — "Você subiu N posições"
// só quando N > 1.
describe('buildCompetitionCelebration — venda: copy por nova posição (§7)', () => {
  it('§30 — 2→1: assumiu a liderança', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 2, newRank: 1 }));
    expect(copy.headline).toBe('Você assumiu a liderança! 🏆');
    expect(copy.message).toBe('Agora você é o 1º colocado.');
  });

  it('2→1 com rival nomeado: menciona o primeiro nome, ainda "assumiu a liderança"', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 2, newRank: 1, relatedSellerLabel: 'João Ferreira' }));
    expect(copy.message).toBe('Você ultrapassou João e assumiu a liderança.');
  });

  it('§30 — 3→2: assumiu o 2º lugar', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 3, newRank: 2 }));
    expect(copy.headline).toBe('Você assumiu o 2º lugar!');
    expect(copy.message).toBe('A liderança está logo ali.');
  });

  it('§30 — 4→3: chegou ao pódio', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 4, newRank: 3 }));
    expect(copy.headline).toBe('Você chegou ao pódio! 🏆');
    expect(copy.message).toBe('Agora você está em 3º lugar.');
  });

  it('§29 — 5→4: subiu no ranking, posição real', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 4 }));
    expect(copy.headline).toBe('Você subiu no ranking! 🚀');
    expect(copy.message).toBe('Agora você está em 4º lugar.');
  });

  it('nenhuma copy de venda menciona saleCount / "N vendas" (§7 não pede isso)', () => {
    for (const e of [
      event({ oldRank: 2, newRank: 1, saleCount: 9 }),
      event({ oldRank: 3, newRank: 2, saleCount: 9 }),
      event({ oldRank: 4, newRank: 3, saleCount: 9 }),
      event({ oldRank: 5, newRank: 4, saleCount: 9 }),
    ]) {
      const copy = buildCompetitionCelebration(e);
      expect(copy.headline + ' ' + copy.message).not.toMatch(/\d+\s+vendas?/);
    }
  });
});

describe('buildCompetitionCelebration — venda: salto de várias posições (§8/§31)', () => {
  it('§31 — 6→3: "Você subiu 3 posições e agora está em 3º lugar."', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 6, newRank: 3 }));
    expect(copy.headline).toBe('Você chegou ao pódio! 🏆');
    expect(copy.message).toBe('Você subiu 3 posições e agora está em 3º lugar.');
  });

  it('6→4 (genérico, multi): prefixo de salto + posição', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 6, newRank: 4 }));
    expect(copy.headline).toBe('Você subiu no ranking! 🚀');
    expect(copy.message).toBe('Você subiu 2 posições e agora está em 4º lugar.');
  });

  it('5→1 (multi, sem rival): assumiu a liderança com contagem de salto', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 1, relatedSellerLabel: null }));
    expect(copy.message).toBe('Você subiu 4 posições e assumiu a liderança.');
  });

  it('5→2 (multi): assumiu o 2º lugar com contagem de salto', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 2 }));
    expect(copy.message).toBe('Você subiu 3 posições. A liderança está logo ali.');
  });

  it('§8 — avanço de 1 posição NÃO adiciona "Você subiu 1 posição"', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 4, newRank: 3 }));
    expect(copy.message).not.toMatch(/subiu 1 posiç/);
  });
});

// PODIUM-COMPETITION-R2C-B1-EXEC §27/§28/§29/§30 — eventos causados por
// Visit NUNCA atribuem o avanço a uma venda. competitionStarted é sempre
// false para source='visit' (garantido pelo backend), então não há um
// caso "primeira venda do mês" aqui.
describe('buildCompetitionCelebration — origem Visit (nunca atribui a uma venda)', () => {
  it('liderança via Visit, sem rival: menciona a visita, nunca "com N vendas"', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'visit', newRank: 1, relatedSellerLabel: null, saleCount: 3 }));
    expect(copy.headline).toBe('Parabéns!');
    expect(copy.message).toBe('Você concluiu uma visita e assumiu o 1º lugar.');
    expect(copy.message).not.toMatch(/vendas?/);
  });

  it('liderança via Visit, com rival: mesma copy de "ultrapassou" (nao menciona mecanismo)', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'visit', newRank: 1, relatedSellerLabel: 'João Ferreira' }));
    expect(copy.message).toBe('Você ultrapassou João e assumiu o 1º lugar.');
  });

  it('Top 3 via Visit: menciona a visita, nunca saleCount/vendas', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'visit', oldRank: 5, newRank: 3, saleCount: 4 }));
    expect(copy.headline).toBe('Você entrou no Top 3!');
    expect(copy.message).toBe('Sua visita realizada levou você ao 3º lugar.');
    expect(copy.message).not.toMatch(/vendas?/);
  });

  it('rank up generico via Visit: menciona a visita, nunca "vendas"', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'visit', oldRank: 6, newRank: 4 }));
    expect(copy.headline).toBe('Você ganhou 2 posições!');
    expect(copy.message).toBe('Sua visita realizada levou você ao 4º lugar.');
    expect(copy.message).not.toMatch(/vendas?/);
  });

  it('mesmo old/new rank, source diferente: Sale usa a copy por posição (§7), Visit a copy da visita', () => {
    const sale = buildCompetitionCelebration(event({ sourceType: 'sale', oldRank: 6, newRank: 4 }));
    const visit = buildCompetitionCelebration(event({ sourceType: 'visit', oldRank: 6, newRank: 4 }));
    expect(sale.message).toBe('Você subiu 2 posições e agora está em 4º lugar.');
    expect(visit.message).toBe('Sua visita realizada levou você ao 4º lugar.');
  });
});

// COMPETITION-V2-B2-EXEC §15/§16 — eventos causados por um NOVO
// AGENDAMENTO (source_type='appointment', produzido por create_visit).
// Nunca atribui o avanço a uma venda nem a uma visita REALIZADA — a visita
// foi só gerada. competitionStarted é sempre false (backend).
describe('buildCompetitionCelebration — origem Agendamento', () => {
  it('liderança via agendamento, sem rival: menciona o novo agendamento, nunca "vendas" nem "visita realizada"', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'appointment', newRank: 1, relatedSellerLabel: null, saleCount: 3 }));
    expect(copy.headline).toBe('Parabéns!');
    expect(copy.message).toBe('Seu novo agendamento levou você ao 1º lugar.');
    expect(copy.message).not.toMatch(/vendas?|visita realizada/i);
  });

  it('liderança via agendamento, com rival: mesma copy de "ultrapassou" (não menciona mecanismo)', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'appointment', newRank: 1, relatedSellerLabel: 'Fernanda Dias' }));
    expect(copy.message).toBe('Você ultrapassou Fernanda e assumiu o 1º lugar.');
  });

  it('Top 3 via agendamento: menciona o agendamento, nunca vendas/visita realizada', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'appointment', oldRank: 5, newRank: 3, saleCount: 4 }));
    expect(copy.headline).toBe('Você entrou no Top 3!');
    expect(copy.message).toBe('Seu novo agendamento levou você ao 3º lugar.');
    expect(copy.message).not.toMatch(/vendas?|visita realizada/i);
  });

  it('rank up genérico via agendamento (1 posição): headline singular + causa correta', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'appointment', oldRank: 5, newRank: 4 }));
    expect(copy.headline).toBe('Você ganhou 1 posição!');
    expect(copy.message).toBe('Seu novo agendamento levou você ao 4º lugar.');
  });

  it('rank up genérico via agendamento (>1 posição): headline plural', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'appointment', oldRank: 6, newRank: 4 }));
    expect(copy.headline).toBe('Você ganhou 2 posições!');
    expect(copy.message).toBe('Seu novo agendamento levou você ao 4º lugar.');
    expect(copy.message).not.toMatch(/vendas?|visita realizada/i);
  });

  it('§16 — os três motivos ficam claramente diferentes para o mesmo old/new rank', () => {
    const base = { oldRank: 6, newRank: 4 } as const;
    const sale = buildCompetitionCelebration(event({ ...base, sourceType: 'sale' })).message;
    const visit = buildCompetitionCelebration(event({ ...base, sourceType: 'visit' })).message;
    const appt = buildCompetitionCelebration(event({ ...base, sourceType: 'appointment' })).message;
    expect(new Set([sale, visit, appt]).size).toBe(3);
    expect(visit).toMatch(/visita realizada/);
    expect(appt).toMatch(/agendamento/);
    expect(sale).not.toMatch(/visita|agendamento/);
  });

  it('nenhuma copy de agendamento usa termos internos (source_type / scheduled visit / appointment)', () => {
    for (const e of [
      event({ sourceType: 'appointment', newRank: 1 }),
      event({ sourceType: 'appointment', oldRank: 5, newRank: 3 }),
      event({ sourceType: 'appointment', oldRank: 6, newRank: 4 }),
    ]) {
      const copy = buildCompetitionCelebration(e);
      const all = `${copy.eyebrow} ${copy.headline} ${copy.message}`;
      expect(all).not.toMatch(/source_type|scheduled_visit|scheduled visit|appointment/i);
      expect(all).not.toContain('—');
    }
  });
});

describe('selectPrimaryCompetitionEvent — tolera source appointment', () => {
  it('escolhe por prioridade de rank, independente de source (appointment não quebra a seleção)', () => {
    const events: UnseenCompetitionEvent[] = [
      event({ id: 'a', sourceType: 'appointment', oldRank: 5, newRank: 4, createdAt: '2026-08-10T10:00:00Z' }),
      event({ id: 'b', sourceType: 'sale', oldRank: 4, newRank: 1, createdAt: '2026-08-10T09:00:00Z' }),
    ];
    expect(selectPrimaryCompetitionEvent(events)?.id).toBe('b'); // newRank === 1 vence
  });
});

describe('buildCompetitionCelebration — regras gerais (§26/§27)', () => {
  it('nenhuma copy contem em dash', () => {
    const cases = [
      event({ competitionStarted: true }),
      event({ newRank: 1, relatedSellerLabel: 'Ana Souza' }),
      event({ oldRank: 5, newRank: 3 }),
      event({ oldRank: 6, newRank: 4 }),
      event({ sourceType: 'visit', newRank: 1 }),
      event({ sourceType: 'visit', oldRank: 5, newRank: 3 }),
      event({ sourceType: 'visit', oldRank: 6, newRank: 4 }),
    ];
    for (const e of cases) {
      const copy = buildCompetitionCelebration(e);
      expect(copy.headline + copy.message).not.toMatch(/—/);
    }
  });

  it('nenhuma copy negativa (caiu/perdeu/ultrapassado)', () => {
    const cases = [
      event({ competitionStarted: true }),
      event({ newRank: 1 }),
      event({ oldRank: 5, newRank: 3 }),
      event({ oldRank: 6, newRank: 4 }),
      event({ sourceType: 'visit', newRank: 1 }),
      event({ sourceType: 'visit', oldRank: 5, newRank: 3 }),
      event({ sourceType: 'visit', oldRank: 6, newRank: 4 }),
    ];
    for (const e of cases) {
      const copy = buildCompetitionCelebration(e);
      expect(copy.headline + copy.message).not.toMatch(/caiu|perdeu|ultrapassad[oa] por|em último/i);
    }
  });
});

describe('selectPrimaryCompetitionEvent — prioridade com multiplos unseen', () => {
  it('lista vazia: null', () => {
    expect(selectPrimaryCompetitionEvent([])).toBeNull();
  });

  it('competition_started tem prioridade sobre qualquer outro', () => {
    const started = event({ id: 'a', competitionStarted: true, oldRank: 2, newRank: 1 });
    const tookLead = event({ id: 'b', newRank: 1, oldRank: 2 });
    expect(selectPrimaryCompetitionEvent([tookLead, started])).toBe(started);
  });

  it('assumiu 1o tem prioridade sobre entrou no Top 3', () => {
    const top3 = event({ id: 'a', oldRank: 5, newRank: 3 });
    const lead = event({ id: 'b', oldRank: 4, newRank: 1 });
    expect(selectPrimaryCompetitionEvent([top3, lead])).toBe(lead);
  });

  it('entrou no Top 3 tem prioridade sobre rank up generico', () => {
    const generic = event({ id: 'a', oldRank: 6, newRank: 4 });
    const top3 = event({ id: 'b', oldRank: 5, newRank: 3 });
    expect(selectPrimaryCompetitionEvent([generic, top3])).toBe(top3);
  });

  it('mesma prioridade: mais posicoes ganhas vence', () => {
    const small = event({ id: 'a', oldRank: 6, newRank: 5 });
    const big = event({ id: 'b', oldRank: 8, newRank: 4 });
    expect(selectPrimaryCompetitionEvent([small, big])).toBe(big);
  });

  it('empate total: o mais recente vence', () => {
    const older = event({ id: 'a', oldRank: 6, newRank: 4, createdAt: '2026-08-10T10:00:00Z' });
    const newer = event({ id: 'b', oldRank: 6, newRank: 4, createdAt: '2026-08-10T12:00:00Z' });
    expect(selectPrimaryCompetitionEvent([older, newer])).toBe(newer);
  });

  // COMPETITION-RANKUP-FEEDBACK-V1-EXEC §3/§23/§31 — defensivo: eventos que
  // não são melhora real nunca viram comemoração (o backend já filtra, mas
  // a UI não confia nisso cegamente).
  it('§31 — evento sem avanço (4→4) é ignorado', () => {
    expect(selectPrimaryCompetitionEvent([event({ oldRank: 4, newRank: 4 })])).toBeNull();
  });

  it('§23 — evento de QUEDA (3→4) é ignorado, nunca vira celebração negativa', () => {
    expect(selectPrimaryCompetitionEvent([event({ oldRank: 3, newRank: 4 })])).toBeNull();
  });

  it('§31 — mistura: só o avanço real é considerado', () => {
    const flat = event({ id: 'flat', oldRank: 4, newRank: 4 });
    const up = event({ id: 'up', oldRank: 5, newRank: 2 });
    expect(selectPrimaryCompetitionEvent([flat, up])?.id).toBe('up');
  });

  it('competition_started sem avanço numérico (0→1 conceitual) continua válido', () => {
    const started = event({ competitionStarted: true, oldRank: 1, newRank: 1 });
    expect(selectPrimaryCompetitionEvent([started])).toBe(started);
  });
});

// COMPETITION-RANKUP-FEEDBACK-V1-EXEC §9-§12/§32 — prêmio da nova posição
// derivado do overview de premiação já existente.
function overview(over: Partial<RewardsOverview> = {}): RewardsOverview {
  return {
    monthStart: '2026-08-01',
    campaign: {
      id: 'camp-1', status: 'published', title: null, totalAmountCents: 175000,
      tiers: [
        { position: 1, amountCents: 100000, rewardText: null },
        { position: 2, amountCents: 50000, rewardText: '1 dia de folga' },
        { position: 3, amountCents: null, rewardText: 'Vale-combustível' },
      ],
    },
    myRank: null,
    myReward: null,
    firstPlaceReward: { amountCents: 100000, rewardText: null },
    lastResult: null,
    ...over,
  };
}

describe('resolveCelebrationReward (§9-§12/§32)', () => {
  it('sem overview: nada', () => {
    expect(resolveCelebrationReward(null, 2)).toEqual({ positionReward: null, firstPlaceReward: null });
  });

  it('§10 — campanha DRAFT nunca vira prêmio', () => {
    const r = resolveCelebrationReward(overview({ campaign: { id: 'c', status: 'draft', title: null, totalAmountCents: 0, tiers: [{ position: 2, amountCents: 50000, rewardText: null }] } }), 2);
    expect(r.positionReward).toBeNull();
  });

  it('§9 — money only: tier da nova posição', () => {
    const r = resolveCelebrationReward(overview(), 1);
    expect(r.positionReward).toEqual({ amountCents: 100000, rewardText: null });
  });

  it('§9 — money + text', () => {
    const r = resolveCelebrationReward(overview(), 2);
    expect(r.positionReward).toEqual({ amountCents: 50000, rewardText: '1 dia de folga' });
  });

  it('§9 — text only (amountCents null)', () => {
    const r = resolveCelebrationReward(overview(), 3);
    expect(r.positionReward).toEqual({ amountCents: null, rewardText: 'Vale-combustível' });
  });

  it('§10 — sem tier para a nova posição: positionReward null (nunca R$ 0)', () => {
    const r = resolveCelebrationReward(overview(), 5);
    expect(r.positionReward).toBeNull();
  });

  it('§10 — tier existe mas vazio (0 e sem texto): tratado como sem prêmio', () => {
    const r = resolveCelebrationReward(overview({ campaign: { id: 'c', status: 'published', title: null, totalAmountCents: 0, tiers: [{ position: 2, amountCents: 0, rewardText: '  ' }] } }), 2);
    expect(r.positionReward).toBeNull();
  });

  it('§11 — nova posição 2..N: expõe o prêmio do 1º lugar', () => {
    expect(resolveCelebrationReward(overview(), 2).firstPlaceReward).toEqual({ amountCents: 100000, rewardText: null });
    expect(resolveCelebrationReward(overview(), 4).firstPlaceReward).toEqual({ amountCents: 100000, rewardText: null });
  });

  it('§11 — nova posição 1: não repete o prêmio do 1º como "first place"', () => {
    expect(resolveCelebrationReward(overview(), 1).firstPlaceReward).toBeNull();
  });
});
