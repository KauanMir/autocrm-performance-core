// lib/date/companyPeriod.ts — HOME-FILTERS-R1-EXEC. Boundaries de período
// para o filtro real do Pódio, ancoradas no timezone REAL da empresa
// (companies.timezone via useCurrentCompanyTimezone), nunca no timezone do
// navegador. Puro: sem React, sem rede, sem `new Date()` implícito — "agora"
// é sempre recebido por parâmetro, testável deterministicamente.
//
// Técnica sem biblioteca externa (nenhuma dependência de data nova no
// projeto): Intl.DateTimeFormat com `timeZone` para ler a hora de parede
// real num instante UTC, e uma dupla conversão para achar o instante UTC
// que corresponde a uma meia-noite local — correta através de mudanças de
// DST porque consulta o timezone real no instante exato, nunca um offset
// fixo.
export type PeriodPreset = 'Hoje' | '7 dias' | '15 dias' | '30 dias';

export interface MillisRange {
  startMillis: number;
  endMillis: number;
}

// HOME-FILTERS-R1-EXEC / PODIUM-COMPETITION-R1-EXEC — resolução do período
// em uso pelo Pódio/leaderboard real, discriminada para o consumidor saber
// exatamente por que ainda não tem uma janela pronta: 'loading' enquanto o
// timezone da empresa carrega (nunca um filtro aplicado com timezone do
// navegador), 'unavailable'/'error' espelham o próprio status de
// useCurrentCompanyTimezone, 'ready' carrega o range calculado (preset ou
// custom, sempre ancorado no timezone real). Movido para cá (fora de
// Home.tsx) para que lib/hooks/useCompanySellerLeaderboard.ts também possa
// usá-lo, sem um hook importando de um arquivo de componente.
export type ResolvedPeriod =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; retry: () => void }
  | ({ kind: 'ready' } & MillisRange);

function zonedYMD(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

// Offset (ms) entre "hora de parede em timeZone no instante `date`" e o
// próprio instante UTC.
function zoneOffsetMillis(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // alguns ambientes retornam '24' à meia-noite com hour12:false
  const asIfUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asIfUtc - date.getTime();
}

// Instante UTC (ms) correspondente a 00:00:00 local de year-month-day em
// timeZone.
function zonedMidnightMillis(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offset = zoneOffsetMillis(new Date(guess), timeZone);
  return guess - offset;
}

// Aritmética de calendário pura (Y/M/D são inteiros, não horas de parede) —
// nunca sofre com DST, porque não representa um instante, só uma data.
function addCivilDays(year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const PRESET_DAYS: Record<PeriodPreset, number> = {
  'Hoje': 1,
  '7 dias': 7,
  '15 dias': 15,
  '30 dias': 30,
};

// "N dias civis inclusivos": início do dia civil de hoje menos (N-1) dias
// (no timezone da empresa) até `now` — "Hoje" é o caso N=1. Nunca
// `new Date()` interno.
export function resolvePresetRange(preset: PeriodPreset, timeZone: string, now: Date): MillisRange {
  const days = PRESET_DAYS[preset];
  const today = zonedYMD(now, timeZone);
  const start = addCivilDays(today.year, today.month, today.day, -(days - 1));
  return {
    startMillis: zonedMidnightMillis(start.year, start.month, start.day, timeZone),
    endMillis: now.getTime(),
  };
}

// start/end no formato 'YYYY-MM-DD' (o mesmo que <input type="date">
// produz). start inclusive às 00:00 local; end inclusive até o fim do dia
// civil local (a próxima meia-noite local menos 1ms). Retorna null se o
// formato for inválido ou start > end — quem chama decide a copy de erro,
// este helper não sabe de UI.
export function resolveCustomRange(startYMD: string, endYMD: string, timeZone: string): MillisRange | null {
  const pattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const sm = pattern.exec(startYMD);
  const em = pattern.exec(endYMD);
  if (!sm || !em) return null;
  if (startYMD > endYMD) return null;

  const sy = Number(sm[1]), smo = Number(sm[2]), sd = Number(sm[3]);
  const ey = Number(em[1]), emo = Number(em[2]), ed = Number(em[3]);

  const startMillis = zonedMidnightMillis(sy, smo, sd, timeZone);
  const nextDay = addCivilDays(ey, emo, ed, 1);
  const endMillis = zonedMidnightMillis(nextDay.year, nextDay.month, nextDay.day, timeZone) - 1;
  return { startMillis, endMillis };
}

export function isWithinRange(iso: string, range: MillisRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.startMillis && t <= range.endMillis;
}
