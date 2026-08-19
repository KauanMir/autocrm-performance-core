// Testes de lib/tasks/formatTaskWhen.ts (COMMERCIAL-REMOTE-B1-B1). Puro —
// `now`/`dueAt` sempre construídos explicitamente (nunca dependem do
// timezone/relógio real da máquina de CI). HH:MM sempre com 2 dígitos.
import { describe, expect, it } from 'vitest';
import { formatTaskWhen } from '@/lib/tasks/formatTaskWhen';

describe('formatTaskWhen', () => {
  it('mesmo dia → "Hoje, HH:MM"', () => {
    const now = new Date(2026, 7, 21, 10, 0);
    const dueAt = new Date(2026, 7, 21, 14, 5);
    expect(formatTaskWhen(dueAt, now)).toBe('Hoje, 14:05');
  });

  it('dia seguinte → "Amanhã, HH:MM"', () => {
    const now = new Date(2026, 7, 21, 10, 0);
    const dueAt = new Date(2026, 7, 22, 9, 0);
    expect(formatTaskWhen(dueAt, now)).toBe('Amanhã, 09:00');
  });

  it('dia anterior → "Venceu ontem, HH:MM"', () => {
    const now = new Date(2026, 7, 21, 10, 0);
    const dueAt = new Date(2026, 7, 20, 16, 0);
    expect(formatTaskWhen(dueAt, now)).toBe('Venceu ontem, 16:00');
  });

  it('N dias atrás → "Venceu há N dias, HH:MM"', () => {
    const now = new Date(2026, 7, 21, 10, 0);
    const dueAt = new Date(2026, 7, 18, 8, 30);
    expect(formatTaskWhen(dueAt, now)).toBe('Venceu há 3 dias, 08:30');
  });

  it('dia futuro distante → "{Dia abrev}, DD/MM, HH:MM"', () => {
    // 21/08/2026 é uma sexta-feira.
    const now = new Date(2026, 7, 17, 10, 0); // segunda
    const dueAt = new Date(2026, 7, 21, 15, 30); // sexta
    expect(formatTaskWhen(dueAt, now)).toBe('Sex, 21/08, 15:30');
  });

  it('HH:MM sempre com 2 dígitos, inclusive minutos/horas < 10', () => {
    const now = new Date(2026, 7, 21, 10, 0);
    const dueAt = new Date(2026, 7, 21, 9, 5);
    expect(formatTaskWhen(dueAt, now)).toBe('Hoje, 09:05');
  });

  it('virada de mês/ano não quebra o cálculo de "ontem"/"amanhã"', () => {
    const now = new Date(2027, 0, 1, 10, 0); // 01/01/2027
    const dueAtOntem = new Date(2026, 11, 31, 23, 0); // 31/12/2026
    expect(formatTaskWhen(dueAtOntem, now)).toBe('Venceu ontem, 23:00');

    const dueAtAmanha = new Date(2027, 0, 2, 8, 0);
    expect(formatTaskWhen(dueAtAmanha, now)).toBe('Amanhã, 08:00');
  });
});
