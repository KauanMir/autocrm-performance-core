// lib/podium/competition.ts — PODIUM-COMPETITION-R2A-EXEC. Camada pessoal
// ("Minha Disputa" + CompTicker) derivada 100% do MESMO leaderboard
// company-wide já lido por useCompanySellerLeaderboard (R1) — nenhuma
// segunda fonte, nenhuma tabela nova, nenhum histórico. Puro: sem React,
// sem chamada de rede, testável isoladamente (§30 do EXEC).
//
// Regra central (§8/§9/§11 do EXEC): a linha "acima" de mim no ranking
// (rival, líder do Top 3, ou eu acima do meu perseguidor) sempre tem
// saleCount >= a da linha "abaixo" — é assim que a RPC ordena. Quando os
// dois lados empatam em saleCount, o desempate real da RPC (visitas, depois
// MAX(sold_at)/nome/id) explica a ordem — nunca expomos esses critérios
// técnicos, só o fato de "empatados em vendas" (e, quando aplicável,
// "e visitas").
export interface CompetitionRow {
  sellerId: string;
  sellerLabel: string;
  saleCount: number;
  completedVisitCount: number;
  rank: number;
}

export type MyCompetitionState =
  | { status: 'unavailable' }
  // Roster real existe mas TODAS as vendas são 0 (empresa no empty state
  // do R1) — nunca inventa posição/rival/disputa (§12 do EXEC). Na prática
  // Home.tsx já filtra isso via leaderboard.status !== 'ready' antes de
  // chamar este helper, mas o helper garante a mesma regra sozinho.
  | { status: 'no_competition' }
  | { status: 'leading'; me: CompetitionRow; chaser: CompetitionRow | null }
  | { status: 'chasing'; me: CompetitionRow; rival: CompetitionRow };

export function resolveMyCompetitionState(
  rows: readonly CompetitionRow[],
  mySellerId: string | null,
): MyCompetitionState {
  if (!mySellerId || rows.length === 0) return { status: 'unavailable' };
  const me = rows.find((r) => r.sellerId === mySellerId);
  if (!me) return { status: 'unavailable' };
  if (rows.every((r) => r.saleCount === 0)) return { status: 'no_competition' };

  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const myIndex = sorted.findIndex((r) => r.sellerId === mySellerId);
  if (myIndex === 0) {
    return { status: 'leading', me, chaser: sorted.length > 1 ? sorted[1] : null };
  }
  return { status: 'chasing', me, rival: sorted[myIndex - 1] };
}

type SalesComparison =
  | { kind: 'gap'; gap: number }
  | { kind: 'tie_by_visits' }
  | { kind: 'tie_full' };

// `ahead` é sempre a linha melhor-ou-igual ranqueada (rival acima de mim,
// eu acima do meu perseguidor, ou o 3º colocado em relação a mim quando
// estou fora do Top 3) — nunca o contrário.
function compareBySales(ahead: CompetitionRow, behind: CompetitionRow): SalesComparison {
  const gap = ahead.saleCount - behind.saleCount;
  if (gap > 0) return { kind: 'gap', gap };
  if (ahead.completedVisitCount > behind.completedVisitCount) return { kind: 'tie_by_visits' };
  return { kind: 'tie_full' };
}

// Exportadas: reaproveitadas por lib/podium/competitionCelebration.ts
// (PODIUM-COMPETITION-R2B-B1-EXEC) — mesma convenção de copy (primeiro
// nome, singular/plural de "venda"), nunca duas implementações.
export function firstName(label: string): string {
  const trimmed = label.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function vendaWord(n: number): string {
  return n === 1 ? '1 venda' : `${n} vendas`;
}

// §8/§9 — copy do rival direto (linha imediatamente acima de mim).
function describeRival(me: CompetitionRow, rival: CompetitionRow): string {
  const cmp = compareBySales(rival, me);
  const name = firstName(rival.sellerLabel);
  if (cmp.kind === 'gap') {
    return cmp.gap === 1
      ? `Falta 1 venda para alcançar ${name}.`
      : `Faltam ${cmp.gap} vendas para alcançar ${name}.`;
  }
  if (cmp.kind === 'tie_by_visits') {
    return `Vocês estão empatados em vendas. ${name} está na frente pelo número de visitas realizadas.`;
  }
  return `Vocês estão empatados em vendas e visitas. ${name} está à frente pelo critério de desempate.`;
}

// §10 — identifica o perseguidor mais próximo (2º colocado) quando eu lidero.
function describeChaser(chaser: CompetitionRow): string {
  return `${firstName(chaser.sellerLabel)} está logo atrás com ${vendaWord(chaser.saleCount)}.`;
}

// §10 — distância da minha liderança para o perseguidor (ou "pelo
// desempate" quando empatados em vendas).
function describeLeaderGap(me: CompetitionRow, chaser: CompetitionRow): string {
  const cmp = compareBySales(me, chaser);
  if (cmp.kind === 'gap') return `Você lidera por ${vendaWord(cmp.gap)}.`;
  return 'Você está na liderança pelo desempate.';
}

// §11 — gap para o 3º colocado, SOMENTE quando o cálculo é direto (nunca
// "Faltam 0 vendas" em caso de empate — nesse caso retorna null e o card
// simplesmente não mostra esta linha).
function describeTop3Gap(me: CompetitionRow, top3Row: CompetitionRow): string | null {
  const cmp = compareBySales(top3Row, me);
  if (cmp.kind !== 'gap') return null;
  return cmp.gap === 1 ? 'Falta 1 venda para entrar no Top 3.' : `Faltam ${cmp.gap} vendas para entrar no Top 3.`;
}

export interface CompetitionLine {
  id: 'leading' | 'leader-gap' | 'chaser' | 'rival' | 'top3';
  icon: string;
  c: string;
  title: string;
  text: string;
}

// Linhas para o card "Minha Disputa" (§6/§10/§24) — preserva a estrutura
// visual do RaceMsg legado, conteúdo 100% real. Ordem fixa: estado
// principal primeiro, detalhe de distância depois.
export function buildMinhaDisputaLines(
  state: MyCompetitionState,
  rows: readonly CompetitionRow[],
): CompetitionLine[] {
  if (state.status === 'leading') {
    const lines: CompetitionLine[] = [
      { id: 'leading', icon: 'trophy', c: '#E8CE72', title: 'Liderança', text: 'Você está na liderança.' },
    ];
    if (state.chaser) {
      lines.push({ id: 'leader-gap', icon: 'zap', c: '#27C75F', title: 'Vantagem', text: describeLeaderGap(state.me, state.chaser) });
      lines.push({ id: 'chaser', icon: 'flame', c: '#FF8A00', title: 'Perseguição', text: describeChaser(state.chaser) });
    }
    return lines;
  }
  if (state.status === 'chasing') {
    const lines: CompetitionLine[] = [
      { id: 'rival', icon: 'target', c: '#E23744', title: 'Rival direto', text: describeRival(state.me, state.rival) },
    ];
    const top3Row = rows.find((r) => r.rank === 3) ?? null;
    if (top3Row && state.me.rank > 3) {
      const text = describeTop3Gap(state.me, top3Row);
      if (text) lines.push({ id: 'top3', icon: 'flag', c: '#D4AF37', title: 'Top 3', text });
    }
    return lines;
  }
  return [];
}

export interface CompetitionTickerMessage {
  id: 'leader-fact' | 'rival-target' | 'rival-tie' | 'top3-gap' | 'leading';
  icon: string;
  c: string;
  text: string;
}

// Mensagens do CompTicker (§13/§14) — SOMENTE os 5 templates permitidos,
// 100% deriváveis do snapshot atual. Nunca histórico/meta/ultrapassagem.
export function buildCompetitionTickerMessages(
  state: MyCompetitionState,
  rows: readonly CompetitionRow[],
): CompetitionTickerMessage[] {
  if (state.status === 'leading') {
    return [{ id: 'leading', icon: 'trophy', c: '#E8CE72', text: 'Você está na liderança.' }];
  }
  if (state.status !== 'chasing') return [];

  const messages: CompetitionTickerMessage[] = [];
  const leaderRow = rows.find((r) => r.rank === 1) ?? null;
  if (leaderRow) {
    messages.push({
      id: 'leader-fact',
      icon: 'trophy',
      c: '#E8CE72',
      text: `${firstName(leaderRow.sellerLabel)} lidera com ${vendaWord(leaderRow.saleCount)}.`,
    });
  }

  const rivalCmp = compareBySales(state.rival, state.me);
  if (rivalCmp.kind === 'gap') {
    messages.push({
      id: 'rival-target',
      icon: 'target',
      c: '#E23744',
      text: `Seu alvo é ${firstName(state.rival.sellerLabel)}, com ${vendaWord(state.rival.saleCount)}.`,
    });
  } else {
    messages.push({
      id: 'rival-tie',
      icon: 'target',
      c: '#E8CE72',
      text: `Você está empatado em vendas com ${firstName(state.rival.sellerLabel)}.`,
    });
  }

  const top3Row = rows.find((r) => r.rank === 3) ?? null;
  if (top3Row && state.me.rank > 3) {
    const top3Cmp = compareBySales(top3Row, state.me);
    if (top3Cmp.kind === 'gap') {
      messages.push({
        id: 'top3-gap',
        icon: 'flag',
        c: '#D4AF37',
        text: top3Cmp.gap === 1 ? 'Falta 1 venda para entrar no Top 3.' : `Faltam ${top3Cmp.gap} vendas para entrar no Top 3.`,
      });
    }
  }

  return messages;
}
