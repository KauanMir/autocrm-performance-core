// Testes de lib/deals/money.ts (COMMERCIAL-REMOTE-DEALS-B2-A). Puro.
import { describe, expect, it } from 'vitest';
import { formatCentsToBRL } from '@/lib/deals/money';

describe('formatCentsToBRL', () => {
  it('zero', () => {
    expect(formatCentsToBRL(0)).toBe('R$ 0,00');
  });

  it('só centavos (< 1 real)', () => {
    expect(formatCentsToBRL(50)).toBe('R$ 0,50');
    expect(formatCentsToBRL(5)).toBe('R$ 0,05');
  });

  it('valor exato em reais, sem centavos residuais', () => {
    expect(formatCentsToBRL(100)).toBe('R$ 1,00');
    expect(formatCentsToBRL(12000000)).toBe('R$ 120.000,00');
  });

  it('milhares com separador pt-BR', () => {
    expect(formatCentsToBRL(15800000)).toBe('R$ 158.000,00');
    expect(formatCentsToBRL(100000)).toBe('R$ 1.000,00');
  });

  it('valores grandes (dentro de Number safe integer)', () => {
    expect(formatCentsToBRL(999999999)).toBe('R$ 9.999.999,99');
  });

  it('centavos não-redondos preservados', () => {
    expect(formatCentsToBRL(120050)).toBe('R$ 1.200,50');
    expect(formatCentsToBRL(999)).toBe('R$ 9,99');
  });

  it('entrada não-finita (NaN/Infinity) lança RangeError — nunca formata silenciosamente', () => {
    expect(() => formatCentsToBRL(NaN)).toThrow(RangeError);
    expect(() => formatCentsToBRL(Infinity)).toThrow(RangeError);
    expect(() => formatCentsToBRL(-Infinity)).toThrow(RangeError);
  });

  it('valores negativos são formatados (validação de sinal é responsabilidade do adapter/backend, não deste helper)', () => {
    expect(formatCentsToBRL(-100)).toBe('R$ -1,00');
  });
});
