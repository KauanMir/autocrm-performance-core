// META-MVP1 — agendamento do sweep de Lead Ads. Módulo PURO: não publica cron,
// não cria vercel.json, não lê o plano da Vercel. Serve para gerar e validar a
// configuração quando o plano real for confirmado.
//
// Limites oficiais (vercel.com/docs/cron-jobs/usage-and-pricing, 2026-07-15):
//   Hobby: no máximo uma vez por dia, precisão de ±59 min; expressão mais
//          frequente FAZ O DEPLOY FALHAR.
//   Pro / Enterprise: até uma vez por minuto, precisão por minuto.
// Cron da Vercel só roda no deployment de produção e chama GET com
// `Authorization: Bearer <CRON_SECRET>`, que a rota já exige.

export const META_SWEEP_CRON_PATH = '/api/cron/meta-leadgen-sweep';

export type VercelPlan = 'hobby' | 'pro' | 'enterprise';

// Hobby: horário arbitrário fora da virada do dia (UTC). Pro: a cada 5 min,
// alinhado ao primeiro retry (1 min) e ao lease de 300 s do sweep.
export const RECOMMENDED_SWEEP_SCHEDULE: Record<VercelPlan, string> = {
  hobby: '17 6 * * *',
  pro: '*/5 * * * *',
  enterprise: '*/5 * * * *',
};

const FIELD_RANGES: readonly [number, number][] = [
  [0, 59], // minuto
  [0, 23], // hora
  [1, 31], // dia do mês
  [1, 12], // mês
  [0, 7], // dia da semana
];

// Quantos valores distintos um campo cron cobre; null = campo inválido.
function countFieldValues(field: string, [min, max]: [number, number]): number | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const [, range, stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let start = min;
    let end = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      start = a;
      end = b === undefined ? (stepText === undefined ? a : max) : b;
    }
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size;
}

export interface CronAnalysis {
  valid: boolean;
  runsPerDay: number | null;
}

// Execuções por dia num dia em que a expressão roda (dia/mês/semana não
// aumentam a frequência diária, só restringem os dias).
export function analyzeCronExpression(expression: string): CronAnalysis {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { valid: false, runsPerDay: null };
  const counts = fields.map((field, index) => countFieldValues(field, FIELD_RANGES[index]));
  if (counts.some((count) => count === null)) return { valid: false, runsPerDay: null };
  return { valid: true, runsPerDay: (counts[0] as number) * (counts[1] as number) };
}

export type ScheduleCheck =
  | { ok: true; runsPerDay: number; worstRetryDelayMinutes: number }
  | { ok: false; reason: 'invalid_expression' | 'hobby_more_than_daily' };

export function checkScheduleForPlan(expression: string, plan: VercelPlan): ScheduleCheck {
  const analysis = analyzeCronExpression(expression);
  if (!analysis.valid || analysis.runsPerDay === null || analysis.runsPerDay < 1) {
    return { ok: false, reason: 'invalid_expression' };
  }
  if (plan === 'hobby' && analysis.runsPerDay > 1) return { ok: false, reason: 'hobby_more_than_daily' };
  // Pior atraso de um retry vencido até a próxima execução (sem contar a
  // imprecisão de ±59 min do Hobby).
  const worst = Math.ceil((24 * 60) / analysis.runsPerDay) + (plan === 'hobby' ? 59 : 0);
  return { ok: true, runsPerDay: analysis.runsPerDay, worstRetryDelayMinutes: worst };
}

// Configuração para colar em vercel.json quando o plano for confirmado.
export function buildVercelCronConfig(plan: VercelPlan, expression = RECOMMENDED_SWEEP_SCHEDULE[plan]) {
  const check = checkScheduleForPlan(expression, plan);
  if (!check.ok) throw new Error(`incompatible_schedule:${'reason' in check ? check.reason : 'unknown'}`);
  return { crons: [{ path: META_SWEEP_CRON_PATH, schedule: expression }] };
}
