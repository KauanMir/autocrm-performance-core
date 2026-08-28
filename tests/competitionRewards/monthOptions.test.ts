// COMPETITION-REWARDS-V1-B2-EXEC §5 — seletor de mês (atual + próximo).
import { describe, expect, it } from 'vitest';
import {
  buildRewardMonthOptions,
  currentCompetitionMonthStart,
  addCivilMonth,
  formatMonthLabel,
  monthName,
  isPastMonth,
} from '@/lib/competitionRewards/monthOptions';

describe('currentCompetitionMonthStart', () => {
  it('primeiro dia do mês civil (UTC)', () => {
    expect(currentCompetitionMonthStart(new Date('2026-08-28T12:00:00Z'), 'UTC')).toBe('2026-08-01');
  });

  it('respeita a timezone: 31/ago 23:00 America/Sao_Paulo ainda é agosto', () => {
    expect(currentCompetitionMonthStart(new Date('2026-09-01T01:30:00Z'), 'America/Sao_Paulo')).toBe('2026-08-01');
  });

  it('01/set 03:00Z já é setembro em America/Sao_Paulo', () => {
    expect(currentCompetitionMonthStart(new Date('2026-09-01T03:30:00Z'), 'America/Sao_Paulo')).toBe('2026-09-01');
  });
});

describe('addCivilMonth', () => {
  it('mês normal', () => {
    expect(addCivilMonth('2026-08-01')).toBe('2026-09-01');
  });
  it('vira o ano em dezembro', () => {
    expect(addCivilMonth('2026-12-01')).toBe('2027-01-01');
  });
});

describe('formatMonthLabel / monthName', () => {
  it('§5 — "Agosto 2026" / "Setembro 2026" (sem "de")', () => {
    expect(formatMonthLabel('2026-08-01')).toBe('Agosto 2026');
    expect(formatMonthLabel('2026-09-01')).toBe('Setembro 2026');
  });
  it('monthName isolado', () => {
    expect(monthName('2026-09-01')).toBe('Setembro');
    expect(monthName('2026-03-01')).toBe('Março');
  });
});

describe('buildRewardMonthOptions', () => {
  it('exatamente 2 opções: current + next', () => {
    const opts = buildRewardMonthOptions(new Date('2026-08-15T12:00:00Z'), 'UTC');
    expect(opts).toEqual([
      { monthStart: '2026-08-01', label: 'Agosto 2026', kind: 'current' },
      { monthStart: '2026-09-01', label: 'Setembro 2026', kind: 'next' },
    ]);
  });
});

describe('isPastMonth', () => {
  it('mês anterior ao corrente', () => {
    expect(isPastMonth('2026-07-01', new Date('2026-08-15T12:00:00Z'), 'UTC')).toBe(true);
    expect(isPastMonth('2026-08-01', new Date('2026-08-15T12:00:00Z'), 'UTC')).toBe(false);
    expect(isPastMonth('2026-09-01', new Date('2026-08-15T12:00:00Z'), 'UTC')).toBe(false);
  });
});
