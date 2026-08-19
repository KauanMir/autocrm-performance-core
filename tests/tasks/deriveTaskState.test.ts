// Testes de lib/tasks/deriveTaskState.ts (COMMERCIAL-REMOTE-B1-B1). Puro —
// `now` é sempre injetado explicitamente, nunca depende do relógio real da
// máquina de CI. Cobre: completed, dia passado, mesmo dia antes/depois do
// horário do due_at (TODAY nos dois casos), dia futuro, virada de meia-noite,
// virada de mês, virada de ano.
import { describe, expect, it } from 'vitest';
import { deriveTaskState } from '@/lib/tasks/deriveTaskState';
import { TASK_STATE } from '@/lib/data';

describe('deriveTaskState', () => {
  it('completed → DONE, independente de due_at/now', () => {
    const dueAt = new Date(2026, 0, 1, 10, 0);
    const now = new Date(2030, 11, 31, 23, 59);
    expect(deriveTaskState('completed', dueAt, now)).toBe(TASK_STATE.DONE);
  });

  it('pending, dia anterior ao dia local atual → LATE', () => {
    const dueAt = new Date(2026, 7, 20, 23, 59); // 20/08
    const now = new Date(2026, 7, 21, 0, 1); // 21/08
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.LATE);
  });

  it('pending, mesmo dia, ANTES do horário do due_at → TODAY (nunca "ainda não chegou")', () => {
    const dueAt = new Date(2026, 7, 21, 17, 0); // hoje às 17h
    const now = new Date(2026, 7, 21, 15, 0); // agora são 15h
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.TODAY);
  });

  it('pending, mesmo dia, DEPOIS do horário do due_at → continua TODAY (nunca vira LATE só pela hora)', () => {
    const dueAt = new Date(2026, 7, 21, 14, 0); // hoje às 14h
    const now = new Date(2026, 7, 21, 15, 0); // agora são 15h, já passou da hora
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.TODAY);
  });

  it('pending, dia futuro → UPCOMING', () => {
    const dueAt = new Date(2026, 7, 25, 9, 0);
    const now = new Date(2026, 7, 21, 15, 0);
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.UPCOMING);
  });

  it('virada de meia-noite: 23:59 → 00:01 do dia seguinte muda TODAY para LATE (ganho funcional novo)', () => {
    const dueAt = new Date(2026, 7, 21, 20, 0); // hoje às 20h
    const stillToday = new Date(2026, 7, 21, 23, 59);
    const nextDay = new Date(2026, 7, 22, 0, 1);
    expect(deriveTaskState('pending', dueAt, stillToday)).toBe(TASK_STATE.TODAY);
    expect(deriveTaskState('pending', dueAt, nextDay)).toBe(TASK_STATE.LATE);
  });

  it('virada de mês: 31/01 devido, visto em 01/02 → LATE', () => {
    const dueAt = new Date(2026, 0, 31, 10, 0);
    const now = new Date(2026, 1, 1, 0, 5);
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.LATE);
  });

  it('virada de ano: 31/12 devido, visto em 01/01 do ano seguinte → LATE', () => {
    const dueAt = new Date(2026, 11, 31, 10, 0);
    const now = new Date(2027, 0, 1, 0, 5);
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.LATE);
  });

  it('due_at futuro logo após a virada de ano → UPCOMING', () => {
    const dueAt = new Date(2027, 0, 2, 10, 0);
    const now = new Date(2026, 11, 31, 10, 0);
    expect(deriveTaskState('pending', dueAt, now)).toBe(TASK_STATE.UPCOMING);
  });

  it('default de now é o relógio real quando omitido (smoke test, sem travar o valor)', () => {
    const dueAt = new Date();
    const result = deriveTaskState('pending', dueAt);
    expect([TASK_STATE.LATE, TASK_STATE.TODAY, TASK_STATE.UPCOMING]).toContain(result);
  });
});
