// tests/date/companyPeriod.test.ts — HOME-FILTERS-R1-EXEC. Boundaries
// determinísticos do filtro de período do Pódio, sempre ancorados no
// timezone da EMPRESA (nunca do navegador/CI). América/São_Paulo (UTC-3)
// e Ásia/Tóquio (UTC+9) não têm DST hoje — offsets fixos, então os valores
// esperados abaixo são calculados diretamente via Date.UTC (sem reusar a
// implementação testada).
import { describe, expect, it } from 'vitest';
import { resolvePresetRange, resolveCustomRange, isWithinRange } from '@/lib/date/companyPeriod';

const SP = 'America/Sao_Paulo'; // UTC-3, sem DST atualmente
const TOKYO = 'Asia/Tokyo'; // UTC+9, sem DST atualmente

describe('resolvePresetRange — SP (timezone negativo)', () => {
  const now = new Date('2026-08-24T15:00:00.000Z'); // 2026-08-24 12:00 em SP

  it('Hoje: início é 00:00 local (03:00 UTC), fim é agora', () => {
    const range = resolvePresetRange('Hoje', SP, now);
    expect(range.startMillis).toBe(Date.UTC(2026, 7, 24, 3, 0, 0, 0));
    expect(range.endMillis).toBe(now.getTime());
  });

  it('7 dias: início é 00:00 local de (hoje - 6 dias civis)', () => {
    const range = resolvePresetRange('7 dias', SP, now);
    expect(range.startMillis).toBe(Date.UTC(2026, 7, 18, 3, 0, 0, 0));
  });

  it('15 dias: início é 00:00 local de (hoje - 14 dias civis)', () => {
    const range = resolvePresetRange('15 dias', SP, now);
    expect(range.startMillis).toBe(Date.UTC(2026, 7, 10, 3, 0, 0, 0));
  });

  it('30 dias: início é 00:00 local de (hoje - 29 dias civis), cruzando o mês', () => {
    const range = resolvePresetRange('30 dias', SP, now);
    expect(range.startMillis).toBe(Date.UTC(2026, 6, 26, 3, 0, 0, 0));
  });
});

describe('resolvePresetRange — Tokyo (timezone positivo, "hoje" diverge de SP no mesmo instante UTC)', () => {
  // Mesmo instante UTC do bloco acima, mas em Tóquio (UTC+9) já é
  // madrugada do dia SEGUINTE — prova de que o cálculo usa o timezone real
  // da empresa, nunca um offset fixo/navegador.
  const now = new Date('2026-08-24T15:30:00.000Z'); // 2026-08-25 00:30 em Tóquio

  it('Hoje: início é 00:00 local de Tóquio (dia 25, não 24)', () => {
    const range = resolvePresetRange('Hoje', TOKYO, now);
    expect(range.startMillis).toBe(Date.UTC(2026, 7, 24, 15, 0, 0, 0)); // 2026-08-25T00:00 Tóquio
    expect(range.endMillis).toBe(now.getTime());
  });
});

describe('boundaries [start, end) — evento na fronteira (SP)', () => {
  const now = new Date('2026-08-24T15:00:00.000Z');
  const range = resolvePresetRange('Hoje', SP, now); // start=2026-08-24T03:00:00.000Z

  it('evento 1ms antes do início: fora do range', () => {
    expect(isWithinRange('2026-08-24T02:59:59.999Z', range)).toBe(false);
  });

  it('evento exatamente no início (start INCLUSIVO): dentro do range', () => {
    expect(isWithinRange('2026-08-24T03:00:00.000Z', range)).toBe(true);
  });

  it('evento 1ms antes do fim: dentro do range', () => {
    expect(isWithinRange('2026-08-24T14:59:59.999Z', range)).toBe(true);
  });

  it('evento exatamente no fim (end EXCLUSIVO): FORA do range', () => {
    expect(isWithinRange('2026-08-24T15:00:00.000Z', range)).toBe(false);
  });

  it('evento 1ms depois do fim: fora do range', () => {
    expect(isWithinRange('2026-08-24T15:00:00.001Z', range)).toBe(false);
  });
});

describe('resolveCustomRange — start/end custom, contrato [start, end)', () => {
  it('start 00:00 local inclusive, end = próxima meia-noite local (exclusiva), sem -1ms', () => {
    const range = resolveCustomRange('2026-08-10', '2026-08-12', SP);
    expect(range).not.toBeNull();
    expect(range!.startMillis).toBe(Date.UTC(2026, 7, 10, 3, 0, 0, 0));
    // Fim EXCLUSIVO: 2026-08-13T00:00 SP (= 03:00 UTC), início do dia seguinte a 08-12.
    expect(range!.endMillis).toBe(Date.UTC(2026, 7, 13, 3, 0, 0, 0));
  });

  it('o dia endYMD inteiro conta: 23:59:59.999 local do último dia dentro; a própria meia-noite seguinte fora', () => {
    const range = resolveCustomRange('2026-08-10', '2026-08-12', SP)!;
    expect(isWithinRange('2026-08-13T02:59:59.999Z', range)).toBe(true); // 2026-08-12 23:59:59.999 SP
    expect(isWithinRange('2026-08-13T03:00:00.000Z', range)).toBe(false); // 2026-08-13 00:00:00.000 SP (= end, exclusivo)
  });

  it('nenhum dia desaparece: o mesmo instante (fim do dia) que era o último ms ainda está dentro', () => {
    const range = resolveCustomRange('2026-08-10', '2026-08-12', SP)!;
    // instante que antes era exatamente endMillis (nextMidnight - 1ms) segue dentro
    expect(isWithinRange(new Date(Date.UTC(2026, 7, 13, 3, 0, 0, 0) - 1).toISOString(), range)).toBe(true);
  });

  it('start === end (1 dia só): range [00:00 do dia, 00:00 do dia seguinte)', () => {
    const range = resolveCustomRange('2026-08-10', '2026-08-10', SP);
    expect(range).not.toBeNull();
    expect(range!.startMillis).toBe(Date.UTC(2026, 7, 10, 3, 0, 0, 0));
    expect(range!.endMillis).toBe(Date.UTC(2026, 7, 11, 3, 0, 0, 0));
  });

  it('range inválido: start depois de end retorna null', () => {
    expect(resolveCustomRange('2026-08-15', '2026-08-10', SP)).toBeNull();
  });

  it('range inválido: formato incorreto retorna null', () => {
    expect(resolveCustomRange('10/08/2026', '2026-08-12', SP)).toBeNull();
    expect(resolveCustomRange('2026-08-10', 'não é uma data', SP)).toBeNull();
    expect(resolveCustomRange('', '2026-08-12', SP)).toBeNull();
  });
});

describe('isWithinRange — casos gerais', () => {
  it('Sale muito antes da janela: fora', () => {
    const range = resolvePresetRange('7 dias', SP, new Date('2026-08-24T15:00:00.000Z'));
    expect(isWithinRange('2026-01-01T12:00:00.000Z', range)).toBe(false);
  });

  it('Sale dentro da janela: dentro', () => {
    const range = resolvePresetRange('30 dias', SP, new Date('2026-08-24T15:00:00.000Z'));
    expect(isWithinRange('2026-08-20T12:00:00.000Z', range)).toBe(true);
  });
});
