// Testes de lib/podium/competition.ts (PODIUM-COMPETITION-R2A-EXEC §30).
// Puro: sem React, sem rede — exercita resolveMyCompetitionState,
// buildMinhaDisputaLines e buildCompetitionTickerMessages diretamente a
// partir de rows sintéticas do MESMO shape do leaderboard real (R1).
import { describe, expect, it } from 'vitest';
import {
  resolveMyCompetitionState,
  buildMinhaDisputaLines,
  buildCompetitionTickerMessages,
  type CompetitionRow,
} from '@/lib/podium/competition';

function row(over: Partial<CompetitionRow> = {}): CompetitionRow {
  return { sellerId: 's1', sellerLabel: 'Lucas Martins', saleCount: 3, completedVisitCount: 1, scheduledVisitCount: 0, rank: 1, ...over };
}

describe('resolveMyCompetitionState — casos base', () => {
  it('mySellerId nulo: unavailable', () => {
    expect(resolveMyCompetitionState([row()], null)).toEqual({ status: 'unavailable' });
  });

  it('rows vazio: unavailable', () => {
    expect(resolveMyCompetitionState([], 's1')).toEqual({ status: 'unavailable' });
  });

  it('leaderboard sem o current Seller (fail-safe): unavailable, nunca lança', () => {
    const rows = [row({ sellerId: 's2', sellerLabel: 'Ana Souza', rank: 1 })];
    expect(() => resolveMyCompetitionState(rows, 's1')).not.toThrow();
    expect(resolveMyCompetitionState(rows, 's1')).toEqual({ status: 'unavailable' });
  });

  it('zero Sales (todas as linhas com saleCount 0): no_competition, nunca inventa posição', () => {
    const rows = [
      row({ sellerId: 's1', saleCount: 0, completedVisitCount: 0, rank: 1 }),
      row({ sellerId: 's2', saleCount: 0, completedVisitCount: 2, rank: 2 }),
    ];
    expect(resolveMyCompetitionState(rows, 's1')).toEqual({ status: 'no_competition' });
  });
});

describe('resolveMyCompetitionState — Seller em 1º (leading)', () => {
  it('empresa com 1 Seller: leading, chaser null', () => {
    const rows = [row({ sellerId: 's1', rank: 1 })];
    const state = resolveMyCompetitionState(rows, 's1');
    expect(state.status).toBe('leading');
    expect((state as any).chaser).toBeNull();
  });

  it('empresa com 2 Sellers: leading, chaser é o 2º colocado', () => {
    const rows = [
      row({ sellerId: 's1', saleCount: 5, rank: 1 }),
      row({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 3, rank: 2 }),
    ];
    const state = resolveMyCompetitionState(rows, 's1');
    expect(state.status).toBe('leading');
    expect((state as any).chaser.sellerId).toBe('s2');
  });
});

describe('resolveMyCompetitionState — Seller fora de 1º (chasing)', () => {
  it('Seller em 2º: chasing, rival é o 1º colocado', () => {
    const rows = [
      row({ sellerId: 's2', sellerLabel: 'Ana Souza', saleCount: 5, rank: 1 }),
      row({ sellerId: 's1', saleCount: 3, rank: 2 }),
    ];
    const state = resolveMyCompetitionState(rows, 's1');
    expect(state.status).toBe('chasing');
    expect((state as any).rival.sellerId).toBe('s2');
  });

  it('Seller fora do Top 3 (4º): chasing, rival é o 3º colocado', () => {
    const rows = [
      row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 8, rank: 1 }),
      row({ sellerId: 's3', sellerLabel: 'Bia', saleCount: 6, rank: 2 }),
      row({ sellerId: 's4', sellerLabel: 'João Ferreira', saleCount: 4, rank: 3 }),
      row({ sellerId: 's1', saleCount: 2, rank: 4 }),
    ];
    const state = resolveMyCompetitionState(rows, 's1');
    expect(state.status).toBe('chasing');
    expect((state as any).rival.sellerId).toBe('s4');
  });
});

describe('buildMinhaDisputaLines — rival direto (gap)', () => {
  it('gap de 1 venda: copy singular exata', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 3 }),
      rival: row({ sellerId: 's2', sellerLabel: 'João Ferreira', saleCount: 4, completedVisitCount: 1, rank: 1 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.rival]);
    const rival = lines.find((l) => l.id === 'rival')!;
    expect(rival.text).toBe('Falta 1 venda para alcançar João.');
  });

  it('gap de N vendas: copy plural exata', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 2 }),
      rival: row({ sellerId: 's2', sellerLabel: 'João Ferreira', saleCount: 5, completedVisitCount: 1, rank: 1 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.rival]);
    expect(lines.find((l) => l.id === 'rival')!.text).toBe('Faltam 3 vendas para alcançar João.');
  });
});

describe('buildMinhaDisputaLines — empate com rival (COMPETITION-V2 §9)', () => {
  it('Caso B — empate em vendas, decisão por visitas: nomeia o gap de visitas', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 4, completedVisitCount: 1 }),
      rival: row({ sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 4, completedVisitCount: 3, rank: 1 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.rival]);
    const text = lines.find((l) => l.id === 'rival')!.text;
    expect(text).toBe('Vocês estão empatados em vendas. Fernanda está na frente por 2 visitas.');
    expect(text).not.toMatch(/0 vendas/);
  });

  it('Caso C — empate em vendas e visitas, decisão por agendamentos: nomeia o gap de agendamentos', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 5 }),
      rival: row({ sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 8, rank: 1 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.rival]);
    const text = lines.find((l) => l.id === 'rival')!.text;
    expect(text).toBe('Vocês estão empatados em vendas e visitas. Fernanda está na frente por 3 agendamentos.');
    expect(text).not.toMatch(/first-to-reach|desempate técnico|MAX\(|ORDER BY|sold_at/i);
  });

  it('Caso C singular — gap de 1 agendamento', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 2, completedVisitCount: 1, scheduledVisitCount: 2 }),
      rival: row({ sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 2, completedVisitCount: 1, scheduledVisitCount: 3, rank: 1 }),
    };
    const text = buildMinhaDisputaLines(state, [state.me, state.rival]).find((l) => l.id === 'rival')!.text;
    expect(text).toBe('Vocês estão empatados em vendas e visitas. Fernanda está na frente por 1 agendamento.');
  });

  it('Caso D — empate total nos três critérios: nunca menciona first-to-reach', () => {
    const state = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 3 }),
      rival: row({ sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 3, rank: 1 }),
    };
    const text = buildMinhaDisputaLines(state, [state.me, state.rival]).find((l) => l.id === 'rival')!.text;
    expect(text).toBe('Vocês estão empatados em vendas, visitas e agendamentos com Fernanda.');
    expect(text).not.toMatch(/desempate|MAX\(|ORDER BY|sold_at/i);
  });
});

describe('buildMinhaDisputaLines — liderança pelo 3º critério (§10)', () => {
  it('empatado em vendas e visitas, na frente por agendamentos: "Você está na frente por N agendamentos"', () => {
    const state = {
      status: 'leading' as const,
      me: row({ sellerId: 's1', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 6 }),
      chaser: row({ sellerId: 's2', sellerLabel: 'Fernanda Dias', saleCount: 4, completedVisitCount: 2, scheduledVisitCount: 4, rank: 2 }),
    };
    const gapText = buildMinhaDisputaLines(state, [state.me, state.chaser]).find((l) => l.id === 'leader-gap')!.text;
    expect(gapText).toBe('Vocês estão empatados em vendas e visitas. Você está na frente por 2 agendamentos.');
    expect(gapText).not.toMatch(/humilha|caiu|perdeu/i);
  });
});

describe('buildMinhaDisputaLines — liderança', () => {
  it('líder com vantagem em vendas: linha de liderança + vantagem + perseguidor', () => {
    const state = {
      status: 'leading' as const,
      me: row({ sellerId: 's1', saleCount: 5 }),
      chaser: row({ sellerId: 's2', sellerLabel: 'Lucas Martins', saleCount: 3, rank: 2 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.chaser]);
    expect(lines.find((l) => l.id === 'leading')!.text).toBe('Você está na liderança.');
    expect(lines.find((l) => l.id === 'leader-gap')!.text).toBe('Você lidera por 2 vendas.');
    expect(lines.find((l) => l.id === 'chaser')!.text).toBe('Lucas está logo atrás com 3 vendas.');
  });

  it('líder empatado em vendas, na frente por visitas: nomeia o gap de visitas, nunca "lidera por 0 vendas"', () => {
    const state = {
      status: 'leading' as const,
      me: row({ sellerId: 's1', saleCount: 5, completedVisitCount: 3 }),
      chaser: row({ sellerId: 's2', sellerLabel: 'Lucas Martins', saleCount: 5, completedVisitCount: 1, rank: 2 }),
    };
    const lines = buildMinhaDisputaLines(state, [state.me, state.chaser]);
    const gapText = lines.find((l) => l.id === 'leader-gap')!.text;
    expect(gapText).toBe('Vocês estão empatados em vendas. Você está na frente por 2 visitas.');
    expect(gapText).not.toMatch(/0 vendas/);
  });

  it('líder empatado nos três critérios: "empatados em vendas, visitas e agendamentos", nunca first-to-reach', () => {
    const state = {
      status: 'leading' as const,
      me: row({ sellerId: 's1', saleCount: 5, completedVisitCount: 3, scheduledVisitCount: 2 }),
      chaser: row({ sellerId: 's2', sellerLabel: 'Lucas Martins', saleCount: 5, completedVisitCount: 3, scheduledVisitCount: 2, rank: 2 }),
    };
    const gapText = buildMinhaDisputaLines(state, [state.me, state.chaser]).find((l) => l.id === 'leader-gap')!.text;
    expect(gapText).toBe('Vocês estão empatados em vendas, visitas e agendamentos.');
    expect(gapText).not.toMatch(/desempate|0 vendas/);
  });

  it('empresa com 1 Seller (sem chaser): só a linha de liderança, nenhuma outra', () => {
    const state = { status: 'leading' as const, me: row({ sellerId: 's1' }), chaser: null };
    const lines = buildMinhaDisputaLines(state, [state.me]);
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('leading');
  });
});

describe('buildMinhaDisputaLines — gap para o Top 3', () => {
  it('fora do Top 3, gap direto: linha de Top 3 presente com copy exata', () => {
    const me = row({ sellerId: 's1', saleCount: 1, rank: 4 });
    const rival = row({ sellerId: 's3', sellerLabel: 'Ana', saleCount: 2, rank: 3 });
    const state = { status: 'chasing' as const, me, rival };
    const lines = buildMinhaDisputaLines(state, [me, rival, row({ sellerId: 's2', saleCount: 4, rank: 1 })]);
    expect(lines.find((l) => l.id === 'top3')!.text).toBe('Falta 1 venda para entrar no Top 3.');
  });

  it('fora do Top 3, empatado em vendas com o 3º: nunca mostra "Faltam 0 vendas", omite a linha', () => {
    const me = row({ sellerId: 's1', saleCount: 2, completedVisitCount: 0, rank: 4 });
    const rival = row({ sellerId: 's3', sellerLabel: 'Ana', saleCount: 2, completedVisitCount: 0, rank: 3 });
    const state = { status: 'chasing' as const, me, rival };
    const lines = buildMinhaDisputaLines(state, [me, rival]);
    expect(lines.some((l) => l.id === 'top3')).toBe(false);
    expect(lines.map((l) => l.text).join(' ')).not.toMatch(/0 vendas/);
  });

  it('dentro do Top 3 (rank <= 3): nunca mostra a linha de Top 3', () => {
    const me = row({ sellerId: 's1', saleCount: 4, rank: 2 });
    const rival = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, rank: 1 });
    const state = { status: 'chasing' as const, me, rival };
    const lines = buildMinhaDisputaLines(state, [me, rival]);
    expect(lines.some((l) => l.id === 'top3')).toBe(false);
  });
});

describe('buildMinhaDisputaLines — estados sem disputa', () => {
  it('unavailable: nenhuma linha', () => {
    expect(buildMinhaDisputaLines({ status: 'unavailable' }, [])).toEqual([]);
  });

  it('no_competition (zero Sales): nenhuma linha, nunca inventa disputa', () => {
    expect(buildMinhaDisputaLines({ status: 'no_competition' }, [])).toEqual([]);
  });
});

describe('buildCompetitionTickerMessages — mensagens permitidas (§13)', () => {
  it('líder: somente a mensagem D, texto exato', () => {
    const state = { status: 'leading' as const, me: row({ sellerId: 's1', saleCount: 5 }), chaser: row({ sellerId: 's2', saleCount: 3, rank: 2 }) };
    const msgs = buildCompetitionTickerMessages(state, [state.me, state.chaser]);
    expect(msgs).toEqual([{ id: 'leading', icon: 'trophy', c: '#E8CE72', text: 'Você está na liderança.' }]);
  });

  it('perseguindo com gap direto: mensagens A (líder), B (alvo) e, fora do Top 3, C (gap Top 3)', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Lucas Martins', saleCount: 5, rank: 1 });
    const rival = row({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 3, rank: 2 });
    const me = row({ sellerId: 's1', saleCount: 1, rank: 3 });
    const state = { status: 'chasing' as const, me, rival };
    const msgs = buildCompetitionTickerMessages(state, [leader, rival, me]);
    expect(msgs.map((m) => m.id)).toEqual(['leader-fact', 'rival-target']);
    expect(msgs[0].text).toBe('Lucas lidera com 5 vendas.');
    expect(msgs[1].text).toBe('Seu alvo é João, com 3 vendas.');
  });

  it('perseguindo com gap para o Top 3 (fora do Top 3): inclui mensagem C com texto exato', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Lucas Martins', saleCount: 6, rank: 1 });
    const third = row({ sellerId: 's3', sellerLabel: 'Ana', saleCount: 4, rank: 3 });
    const me = row({ sellerId: 's1', saleCount: 3, rank: 4 });
    const rival = third;
    const state = { status: 'chasing' as const, me, rival };
    const msgs = buildCompetitionTickerMessages(state, [leader, third, me]);
    const top3 = msgs.find((m) => m.id === 'top3-gap');
    expect(top3?.text).toBe('Falta 1 venda para entrar no Top 3.');
  });

  it('empate em vendas, decisão por visitas: rival-tie nomeia o gap de visitas (§11 — nunca só "empatado em vendas")', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, rank: 1 });
    const me = row({ sellerId: 's1', saleCount: 3, completedVisitCount: 0, rank: 3 });
    const rival = row({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 3, completedVisitCount: 2, rank: 2 });
    const state = { status: 'chasing' as const, me, rival };
    const msgs = buildCompetitionTickerMessages(state, [leader, rival, me]);
    expect(msgs.find((m) => m.id === 'rival-tie')?.text).toBe('Você está empatado em vendas com João. João está na frente por 2 visitas.');
    expect(msgs.some((m) => m.id === 'rival-target')).toBe(false);
  });

  it('empate em vendas e visitas, decisão por agendamentos: rival-tie nomeia o gap de agendamentos', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, rank: 1 });
    const me = row({ sellerId: 's1', saleCount: 3, completedVisitCount: 1, scheduledVisitCount: 1, rank: 3 });
    const rival = row({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 3, completedVisitCount: 1, scheduledVisitCount: 4, rank: 2 });
    const state = { status: 'chasing' as const, me, rival };
    const msgs = buildCompetitionTickerMessages(state, [leader, rival, me]);
    expect(msgs.find((m) => m.id === 'rival-tie')?.text).toBe('Você está empatado em vendas e visitas com João. João está na frente por 3 agendamentos.');
  });

  it('empate total nos três critérios: rival-tie sem menção a first-to-reach', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, rank: 1 });
    const me = row({ sellerId: 's1', saleCount: 3, completedVisitCount: 2, scheduledVisitCount: 3, rank: 3 });
    const rival = row({ sellerId: 's3', sellerLabel: 'João Ferreira', saleCount: 3, completedVisitCount: 2, scheduledVisitCount: 3, rank: 2 });
    const state = { status: 'chasing' as const, me, rival };
    const msgs = buildCompetitionTickerMessages(state, [leader, rival, me]);
    const text = msgs.find((m) => m.id === 'rival-tie')?.text;
    expect(text).toBe('Você está empatado em vendas, visitas e agendamentos com João.');
    expect(text).not.toMatch(/desempate|MAX\(|sold_at/i);
  });

  it('sem disputa (unavailable/no_competition): nenhuma mensagem', () => {
    expect(buildCompetitionTickerMessages({ status: 'unavailable' }, [])).toEqual([]);
    expect(buildCompetitionTickerMessages({ status: 'no_competition' }, [])).toEqual([]);
  });

  it('nenhuma mensagem depende de histórico, ultrapassagem ou meta semanal', () => {
    const leader = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, rank: 1 });
    const me = row({ sellerId: 's1', saleCount: 2, rank: 2 });
    const state = { status: 'chasing' as const, me, rival: leader };
    const msgs = buildCompetitionTickerMessages(state, [leader, me]);
    const allText = msgs.map((m) => m.text).join(' ');
    expect(allText).not.toMatch(/subiu|desceu|ultrapass|meta da semana|caiu|AO VIVO/i);
  });
});

describe('COMPETITION-V2 §4 — rank do backend é a autoridade de posição', () => {
  it('resolveMyCompetitionState usa row.rank; nunca recomputa a ordem a partir dos critérios', () => {
    // Cenário deliberadamente "estranho": me tem MAIS vendas que o rival,
    // mas o backend colocou o rival acima (ex.: first-to-reach). O helper
    // deve confiar em rank e me tratar como chasing atrás desse rival.
    const me = row({ sellerId: 's1', saleCount: 5, completedVisitCount: 0, scheduledVisitCount: 0, rank: 2 });
    const rival = row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 5, completedVisitCount: 0, scheduledVisitCount: 0, rank: 1 });
    const state = resolveMyCompetitionState([me, rival], 's1');
    expect(state.status).toBe('chasing');
    expect((state as any).rival.sellerId).toBe('s2');
    expect((state as any).me.rank).toBe(2);
  });
});

describe('COMPETITION-V2 §27 — sem sistema de pontos', () => {
  it('nenhuma copy menciona pontos/score/peso', () => {
    const chasing = {
      status: 'chasing' as const,
      me: row({ sellerId: 's1', saleCount: 3, completedVisitCount: 1, scheduledVisitCount: 2, rank: 3 }),
      rival: row({ sellerId: 's2', sellerLabel: 'Ana', saleCount: 3, completedVisitCount: 1, scheduledVisitCount: 5, rank: 2 }),
    };
    const rows = [row({ sellerId: 's0', saleCount: 9, rank: 1 }), chasing.rival, chasing.me];
    const all = [
      ...buildMinhaDisputaLines(chasing, rows).map((l) => l.text),
      ...buildCompetitionTickerMessages(chasing, rows).map((m) => m.text),
    ].join(' ');
    expect(all).not.toMatch(/\bpontos?\b|\bscore\b|\bpeso\b|=\s*\d+\s*(pt|ponto)/i);
    // "por N agendamentos" aparece; "N pontos" nunca.
    expect(all).toMatch(/agendamentos/);
  });
});
