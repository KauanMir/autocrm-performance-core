// META-MVP1 — compatibilidade do agendamento com o plano da Vercel. Puro.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeCronExpression,
  buildVercelCronConfig,
  checkScheduleForPlan,
  META_SWEEP_CRON_PATH,
  RECOMMENDED_SWEEP_SCHEDULE,
} from '@/lib/server/meta-webhook/sweep-schedule';

describe('analyzeCronExpression', () => {
  it.each([
    ['17 6 * * *', 1],
    ['0 * * * *', 24],
    ['*/5 * * * *', 288],
    ['*/30 * * * *', 48],
    ['0,30 9-17 * * 1-5', 18],
    ['0 6 1 * *', 1],
  ])('%s → %d execuções por dia', (expression, runs) => {
    expect(analyzeCronExpression(expression)).toEqual({ valid: true, runsPerDay: runs });
  });

  it.each(['', '* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', 'a b c d e', '5-1 * * * *'])('%s é inválida', (expression) => {
    expect(analyzeCronExpression(expression).valid).toBe(false);
  });
});

describe('checkScheduleForPlan', () => {
  it('Hobby aceita diário e recusa qualquer frequência maior (o deploy falharia)', () => {
    expect(checkScheduleForPlan('17 6 * * *', 'hobby')).toMatchObject({ ok: true, runsPerDay: 1 });
    expect(checkScheduleForPlan('0 * * * *', 'hobby')).toEqual({ ok: false, reason: 'hobby_more_than_daily' });
    expect(checkScheduleForPlan('*/5 * * * *', 'hobby')).toEqual({ ok: false, reason: 'hobby_more_than_daily' });
  });

  it('Pro aceita a cada 5 minutos com atraso máximo de retry de 5 min', () => {
    expect(checkScheduleForPlan('*/5 * * * *', 'pro')).toEqual({ ok: true, runsPerDay: 288, worstRetryDelayMinutes: 5 });
  });

  it('Hobby: atraso máximo inclui a imprecisão de ±59 min', () => {
    expect(checkScheduleForPlan('17 6 * * *', 'hobby')).toEqual({ ok: true, runsPerDay: 1, worstRetryDelayMinutes: 1440 + 59 });
  });

  it('as recomendações são compatíveis com cada plano', () => {
    for (const plan of ['hobby', 'pro', 'enterprise'] as const) {
      expect(checkScheduleForPlan(RECOMMENDED_SWEEP_SCHEDULE[plan], plan).ok).toBe(true);
    }
  });
});

describe('buildVercelCronConfig', () => {
  it('gera a entrada de cron apontando para a rota real do sweep', () => {
    expect(buildVercelCronConfig('pro')).toEqual({ crons: [{ path: '/api/cron/meta-leadgen-sweep', schedule: '*/5 * * * *' }] });
    const routeFile = path.resolve(process.cwd(), 'app', ...META_SWEEP_CRON_PATH.split('/').filter(Boolean), 'route.ts');
    expect(existsSync(routeFile)).toBe(true);
  });

  it('recusa expressão incompatível com o plano', () => {
    expect(() => buildVercelCronConfig('hobby', '*/5 * * * *')).toThrow('incompatible_schedule:hobby_more_than_daily');
  });
});

// The recovery schedule was published to Production on 2026-11-06 (deployment
// dpl_8wsJZVEKicSS9SoZtLLo2zGAJivG, docs/META-RECOVERY.md); MVP-1 predates it.
// The contract is now: exactly that one schedule, on the real sweep route, at a
// frequency the Pro plan accepts, and no second config file.
describe('agendamento publicado (meta-leadgen-recovery)', () => {
  it('vercel.json tem exatamente o agendamento de recuperação, na rota real do sweep', () => {
    const file = path.resolve(process.cwd(), 'vercel.json');
    expect(existsSync(file)).toBe(true);
    const config = JSON.parse(readFileSync(file, 'utf8')) as {
      crons?: unknown;
      schedules?: Record<string, { schedule: string; path: string; requestMethod?: string }>;
    };
    expect(config.crons).toBeUndefined();
    expect(Object.keys(config.schedules ?? {})).toEqual(['meta-leadgen-recovery']);
    const job = config.schedules!['meta-leadgen-recovery'];
    expect(job.path).toBe(META_SWEEP_CRON_PATH);
    expect(job.requestMethod).toBe('GET');
    expect(job.schedule).toBe(RECOMMENDED_SWEEP_SCHEDULE.pro);
    expect(checkScheduleForPlan(job.schedule, 'pro').ok).toBe(true);
  });

  it('não existe vercel.ts concorrente', () => {
    expect(existsSync(path.resolve(process.cwd(), 'vercel.ts'))).toBe(false);
  });
});
