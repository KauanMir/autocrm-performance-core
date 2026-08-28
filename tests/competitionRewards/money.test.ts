// COMPETITION-REWARDS-V1-B2-EXEC §16/§17/§21/§55/§56 — parser/formatter BRL
// da configuração de premiação. O contrato: format(cents) -> parse -> os
// MESMOS cents (roundtrip), payload sempre integer, nunca float.
import { describe, expect, it } from 'vitest';
import {
  parseBrlInputToCents,
  formatCentsForInput,
  formatCentsToBRL,
  sumTierAmountCents,
} from '@/lib/competitionRewards/money';

describe('parseBrlInputToCents', () => {
  it('campo vazio / sem dígitos → null (nunca 0)', () => {
    expect(parseBrlInputToCents('')).toBeNull();
    expect(parseBrlInputToCents('R$ ')).toBeNull();
    expect(parseBrlInputToCents('abc')).toBeNull();
  });

  it('dígitos acumulam como centavos', () => {
    expect(parseBrlInputToCents('1')).toBe(1);
    expect(parseBrlInputToCents('500')).toBe(500);
    expect(parseBrlInputToCents('100')).toBe(100);
  });

  it('§16 — "R$ 1,00" → 100 ; "R$ 1.000,00" → 100000', () => {
    expect(parseBrlInputToCents('R$ 1,00')).toBe(100);
    expect(parseBrlInputToCents('R$ 1.000,00')).toBe(100000);
  });

  it('ignora qualquer não-dígito (pontuação, espaço, símbolo)', () => {
    expect(parseBrlInputToCents('R$ 1.750,00')).toBe(175000);
    expect(parseBrlInputToCents('12.345,67')).toBe(1234567);
  });

  it('trava defensiva de 12 dígitos (colar acidental não estoura Number)', () => {
    const parsed = parseBrlInputToCents('9'.repeat(40));
    expect(parsed).toBe(999999999999);
    expect(Number.isSafeInteger(parsed as number)).toBe(true);
  });
});

describe('formatCentsForInput / formatCentsToBRL', () => {
  it('null → string vazia (mostra placeholder)', () => {
    expect(formatCentsForInput(null)).toBe('');
  });

  it('formata em R$ pt-BR com 2 casas', () => {
    expect(formatCentsForInput(100)).toBe('R$ 1,00');
    expect(formatCentsForInput(100000)).toBe('R$ 1.000,00');
    expect(formatCentsToBRL(175000)).toBe('R$ 1.750,00');
    expect(formatCentsToBRL(0)).toBe('R$ 0,00');
  });

  it('§55 — roundtrip format → parse → mesmos cents', () => {
    for (const cents of [1, 100, 500, 25000, 100000, 175000, 999999]) {
      expect(parseBrlInputToCents(formatCentsForInput(cents))).toBe(cents);
    }
  });
});

describe('sumTierAmountCents (§21/§56)', () => {
  it('soma só amount_cents não-nulos', () => {
    expect(sumTierAmountCents([
      { amountCents: 100000 },
      { amountCents: 50000 },
      { amountCents: 25000 },
    ])).toBe(175000);
  });

  it('reward_text (amount null) não entra na soma', () => {
    expect(sumTierAmountCents([
      { amountCents: 100000 },
      { amountCents: null },
      { amountCents: 25000 },
    ])).toBe(125000);
  });

  it('todos null → 0', () => {
    expect(sumTierAmountCents([{ amountCents: null }, { amountCents: null }])).toBe(0);
  });
});
