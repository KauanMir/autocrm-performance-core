// Testes de lib/tasks/dueAtHelpers.ts (COMMERCIAL-REMOTE-B1-B1). Puro —
// nenhum mock necessário. Cobre combinação válida, casos de borda de
// calendário (fim de mês, virada de ano, meia-noite/23:59) e rejeição
// determinística de data/hora inválida (nunca `Invalid Date`.toISOString()
// silencioso).
import { describe, expect, it } from 'vitest';
import { combineLocalDateAndTimeToIso } from '@/lib/tasks/dueAtHelpers';

describe('combineLocalDateAndTimeToIso — casos válidos', () => {
  it('data e hora válidas produzem um ISO válido e reversível', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-08-21', time: '15:30' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d = new Date(result.iso);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7); // agosto, índice 0-based
      expect(d.getDate()).toBe(21);
      expect(d.getHours()).toBe(15);
      expect(d.getMinutes()).toBe(30);
    }
  });

  it('00:00 é aceito', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-01-01', time: '00:00' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d = new Date(result.iso);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it('23:59 é aceito', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-12-31', time: '23:59' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d = new Date(result.iso);
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(59);
    }
  });

  it('fim de mês (28/29/30/31 conforme o mês) é aceito quando o dia é real', () => {
    expect(combineLocalDateAndTimeToIso({ date: '2026-02-28', time: '12:00' }).ok).toBe(true); // 2026 não é bissexto
    expect(combineLocalDateAndTimeToIso({ date: '2026-04-30', time: '12:00' }).ok).toBe(true);
    expect(combineLocalDateAndTimeToIso({ date: '2026-01-31', time: '12:00' }).ok).toBe(true);
  });

  it('virada de ano (31/12 e 01/01) é aceita', () => {
    expect(combineLocalDateAndTimeToIso({ date: '2026-12-31', time: '23:30' }).ok).toBe(true);
    expect(combineLocalDateAndTimeToIso({ date: '2027-01-01', time: '00:30' }).ok).toBe(true);
  });

  it('ano bissexto: 29/02 é aceito', () => {
    expect(combineLocalDateAndTimeToIso({ date: '2028-02-29', time: '10:00' }).ok).toBe(true);
  });
});

describe('combineLocalDateAndTimeToIso — rejeição determinística', () => {
  it('mês/dia impossível (31/02) é rejeitado, nunca "rola" para março', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-02-31', time: '12:00' });
    expect(result).toEqual({ ok: false, reason: 'invalid_date' });
  });

  it('29/02 em ano não-bissexto é rejeitado', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-02-29', time: '12:00' });
    expect(result).toEqual({ ok: false, reason: 'invalid_date' });
  });

  it('31/04 (abril tem 30 dias) é rejeitado', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-04-31', time: '12:00' });
    expect(result).toEqual({ ok: false, reason: 'invalid_date' });
  });

  it('mês fora de 1-12 é rejeitado', () => {
    expect(combineLocalDateAndTimeToIso({ date: '2026-13-01', time: '12:00' })).toEqual({ ok: false, reason: 'invalid_date' });
    expect(combineLocalDateAndTimeToIso({ date: '2026-00-01', time: '12:00' })).toEqual({ ok: false, reason: 'invalid_date' });
  });

  it('formato de data malformado é rejeitado', () => {
    for (const bad of ['21/08/2026', '2026-8-21', '2026-08-1', 'not-a-date', '']) {
      expect(combineLocalDateAndTimeToIso({ date: bad, time: '12:00' })).toEqual({ ok: false, reason: 'invalid_date' });
    }
  });

  it('hora fora de 00:00-23:59 é rejeitada', () => {
    expect(combineLocalDateAndTimeToIso({ date: '2026-08-21', time: '24:00' })).toEqual({ ok: false, reason: 'invalid_time' });
    expect(combineLocalDateAndTimeToIso({ date: '2026-08-21', time: '12:60' })).toEqual({ ok: false, reason: 'invalid_time' });
    expect(combineLocalDateAndTimeToIso({ date: '2026-08-21', time: '-1:00' })).toEqual({ ok: false, reason: 'invalid_time' });
  });

  it('formato de hora malformado é rejeitado', () => {
    for (const bad of ['15h30', '15:3', '3:30 PM', 'not-a-time', '']) {
      expect(combineLocalDateAndTimeToIso({ date: '2026-08-21', time: bad })).toEqual({ ok: false, reason: 'invalid_time' });
    }
  });

  it('nunca produz "Invalid Date" — todo resultado ok:true tem um iso parseável de volta', () => {
    const result = combineLocalDateAndTimeToIso({ date: '2026-08-21', time: '15:30' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Number.isNaN(new Date(result.iso).getTime())).toBe(false);
    }
  });
});
