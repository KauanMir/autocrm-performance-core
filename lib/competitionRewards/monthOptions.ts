// lib/competitionRewards/monthOptions.ts — COMPETITION-REWARDS-V1-B2-EXEC
// §5. O seletor de mês da aba Competição oferece SOMENTE dois valores em
// V1: mês oficial corrente e o mês seguinte. Puro (sem React, sem rede) —
// "agora" chega por parâmetro para ser testável deterministicamente.
//
// month_start é sempre o primeiro dia do mês civil na timezone da empresa
// (companies.timezone via useCurrentCompanyTimezone). Quando a timezone
// ainda não resolveu, o chamador passa `undefined` e o Intl usa a do
// navegador — o backend continua sendo a autoridade final (month_closed /
// invalid_month).

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export type RewardMonthOption = {
  // 'YYYY-MM-01'
  monthStart: string;
  // "Agosto 2026"
  label: string;
  // 'current' = mês oficial corrente; 'next' = mês seguinte.
  kind: 'current' | 'next';
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Primeiro dia do mês civil de `now` na timezone dada (ou a do navegador
// quando timeZone é undefined).
export function currentCompetitionMonthStart(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map.year}-${map.month}-01`;
}

// Aritmética de calendário pura (Y/M são inteiros, nunca horas de parede):
// imune a DST porque não representa um instante.
export function addCivilMonth(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${pad2(nextM)}-01`;
}

export function formatMonthLabel(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  const name = MONTHS_PT[m - 1] ?? '';
  return `${name} ${y}`;
}

// Nome do mês por si (para copy: "Premiação de Setembro", "PRÊMIOS DE SETEMBRO").
export function monthName(monthStart: string): string {
  const [, m] = monthStart.split('-').map(Number);
  return MONTHS_PT[m - 1] ?? '';
}

export function buildRewardMonthOptions(now: Date, timeZone?: string): RewardMonthOption[] {
  const current = currentCompetitionMonthStart(now, timeZone);
  const next = addCivilMonth(current);
  return [
    { monthStart: current, label: formatMonthLabel(current), kind: 'current' },
    { monthStart: next, label: formatMonthLabel(next), kind: 'next' },
  ];
}

// month_start < mês corrente (na mesma timezone) — usado só para uma
// mensagem amigável antecipada; a autoridade real é o backend.
export function isPastMonth(monthStart: string, now: Date, timeZone?: string): boolean {
  return monthStart < currentCompetitionMonthStart(now, timeZone);
}
