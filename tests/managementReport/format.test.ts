// Testes de lib/managementReport/format.ts (KPI-REPORTS-B2-EXEC-FRONTEND
// §25/§30/§63). Puro, sem mocks.
import { describe, expect, it } from 'vitest';
import {
  formatRatePercent,
  formatTrendDateShort,
  formatTrendDateLong,
} from '@/lib/managementReport/format';

describe('formatRatePercent — no máximo 2 casas úteis, vírgula pt-BR', () => {
  it('60 -> "60%" (sem zeros finais)', () => {
    expect(formatRatePercent(60)).toBe('60%');
  });

  it('60.00 -> "60%"', () => {
    expect(formatRatePercent(60.0)).toBe('60%');
  });

  it('33.33 -> "33,33%"', () => {
    expect(formatRatePercent(33.33)).toBe('33,33%');
  });

  it('33.3 -> "33,3%" (só um zero final removido)', () => {
    expect(formatRatePercent(33.3)).toBe('33,3%');
  });

  it('0 -> "0%" (o consumidor decide não chamar quando a coorte é vazia)', () => {
    expect(formatRatePercent(0)).toBe('0%');
  });

  it('100 -> "100%"', () => {
    expect(formatRatePercent(100)).toBe('100%');
  });

  it('arredonda para 2 casas antes de formatar', () => {
    expect(formatRatePercent(12.345)).toBe('12,35%');
    expect(formatRatePercent(12.344)).toBe('12,34%');
  });

  it('lança em valor não finito', () => {
    expect(() => formatRatePercent(NaN)).toThrow(RangeError);
    expect(() => formatRatePercent(Infinity)).toThrow(RangeError);
  });
});

describe('formatTrendDate — sem new Date(), data civil intacta', () => {
  it('YYYY-MM-DD -> DD/MM', () => {
    expect(formatTrendDateShort('2026-03-10')).toBe('10/03');
    expect(formatTrendDateShort('2026-12-01')).toBe('01/12');
  });

  it('YYYY-MM-DD -> DD/MM/AAAA', () => {
    expect(formatTrendDateLong('2026-03-10')).toBe('10/03/2026');
  });

  it('string fora do formato volta como veio (defensivo)', () => {
    expect(formatTrendDateShort('qualquer')).toBe('qualquer');
    expect(formatTrendDateLong('2026-03')).toBe('2026-03');
  });
});
