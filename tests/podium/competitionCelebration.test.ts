// Testes de lib/podium/competitionCelebration.ts
// (PODIUM-COMPETITION-R2B-B1-EXEC §44). Puro: sem React, sem rede.
import { describe, expect, it } from 'vitest';
import {
  buildCompetitionCelebration,
  selectPrimaryCompetitionEvent,
} from '@/lib/podium/competitionCelebration';
import type { UnseenCompetitionEvent } from '@/lib/podium/competitionEventsRepository';

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

describe('buildCompetitionCelebration — assumiu 1o lugar (took lead)', () => {
  it('sem related seller: copy generica com saleCount real', () => {
    const copy = buildCompetitionCelebration(event({ newRank: 1, saleCount: 5, relatedSellerLabel: null }));
    expect(copy.headline).toBe('Parabéns!');
    expect(copy.message).toBe('Você assumiu o 1º lugar com 5 vendas.');
  });

  it('saleCount singular: "1 venda", nunca "1 vendas"', () => {
    const copy = buildCompetitionCelebration(event({ newRank: 1, saleCount: 1, relatedSellerLabel: null }));
    expect(copy.message).toBe('Você assumiu o 1º lugar com 1 venda.');
  });

  it('com related seller: menciona o nome real (primeiro nome)', () => {
    const copy = buildCompetitionCelebration(event({ newRank: 1, relatedSellerLabel: 'João Ferreira' }));
    expect(copy.message).toBe('Você ultrapassou João e assumiu o 1º lugar.');
  });
});

describe('buildCompetitionCelebration — entrou no Top 3', () => {
  it('oldRank > 3 e newRank <= 3: copy com posicao e saleCount reais', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 3, saleCount: 4 }));
    expect(copy.headline).toBe('Você entrou no Top 3!');
    expect(copy.message).toBe('Agora você está em 3º lugar com 4 vendas.');
  });

  it('newRank = 2 dentro do Top 3: usa a posicao real (2o), nao sempre "3o"', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 2, saleCount: 6 }));
    expect(copy.message).toBe('Agora você está em 2º lugar com 6 vendas.');
  });
});

describe('buildCompetitionCelebration — rank up generico', () => {
  it('ganhou N posicoes (plural)', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 6, newRank: 4 }));
    expect(copy.headline).toBe('Você ganhou 2 posições!');
    expect(copy.message).toBe('Agora você está em 4º lugar.');
  });

  it('ganhou 1 posicao (singular)', () => {
    const copy = buildCompetitionCelebration(event({ oldRank: 5, newRank: 4 }));
    expect(copy.headline).toBe('Você ganhou 1 posição!');
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

  it('mesmo evento (old/new rank iguais) com source diferente: copy Sale continua igual a antes do R2C', () => {
    const copy = buildCompetitionCelebration(event({ sourceType: 'sale', oldRank: 6, newRank: 4 }));
    expect(copy.message).toBe('Agora você está em 4º lugar.');
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
});
