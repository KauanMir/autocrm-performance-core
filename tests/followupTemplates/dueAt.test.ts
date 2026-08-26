// Testes de resolveFollowUpTemplateDueAt/formatFollowUpDueAtPreview
// (FOLLOW-UP-TEMPLATES-A3-EXEC precheck §51). Puro — sem QueryClient, sem
// Supabase, sem React. `now` sempre fixo/injetado — determinístico.
import { describe, expect, it } from 'vitest';
import { resolveFollowUpTemplateDueAt, formatFollowUpDueAtPreview } from '@/lib/followupTemplates/dueAt';

// Quinta-feira, 20/08/2026 14:30 local.
const NOW = new Date(2026, 7, 20, 14, 30, 0);

describe('resolveFollowUpTemplateDueAt — offset_unit=hour', () => {
  it('1 hora: now + 1h exato, nunca dia civil', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'hour', offsetValue: 1, defaultTime: null }, '', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDateYMD).toBe('2026-08-20');
    expect(result.previewTime).toBe('15:30');
  });

  it('3 horas: now + 3h exato', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'hour', offsetValue: 3, defaultTime: null }, '', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewTime).toBe('17:30');
  });

  it('hora atravessando a meia-noite: vira o dia seguinte corretamente (instante real, nunca dia civil)', () => {
    const lateNight = new Date(2026, 7, 20, 23, 0, 0);
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'hour', offsetValue: 2, defaultTime: null }, '', lateNight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDateYMD).toBe('2026-08-21');
    expect(result.previewTime).toBe('01:00');
  });

  it('nunca depende de chosenTime (ignorado para offset_unit=hour)', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'hour', offsetValue: 1, defaultTime: null }, '09:00', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewTime).toBe('15:30');
  });
});

describe('resolveFollowUpTemplateDueAt — offset_unit=day, COM default_time', () => {
  it('1 dia + horário padrão: dia civil local +1, horário do template', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 1, defaultTime: '09:00' }, '', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDateYMD).toBe('2026-08-21');
    expect(result.previewTime).toBe('09:00');
  });

  it('3 dias + horário padrão: dia civil local +3 (nunca offsetValue*24h)', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 3, defaultTime: '09:00' }, '', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDateYMD).toBe('2026-08-23');
    expect(result.previewTime).toBe('09:00');
  });

  it('chosenTime é ignorado quando o template já tem default_time', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 1, defaultTime: '09:00' }, '18:45', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewTime).toBe('09:00');
  });
});

describe('resolveFollowUpTemplateDueAt — offset_unit=day, SEM default_time', () => {
  it('sem default_time e sem chosenTime: time_required (nunca inventa horário — precheck §35)', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 1, defaultTime: null }, '', NOW);
    expect(result).toEqual({ ok: false, reason: 'time_required' });
  });

  it('sem default_time mas com chosenTime válido: usa o horário escolhido pelo usuário', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 7, defaultTime: null }, '10:00', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDateYMD).toBe('2026-08-27');
    expect(result.previewTime).toBe('10:00');
  });

  it('chosenTime inválido: invalid_time', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 1, defaultTime: null }, '25:00', NOW);
    expect(result).toEqual({ ok: false, reason: 'invalid_time' });
  });
});

describe('resolveFollowUpTemplateDueAt — semântica de dia civil (nunca timezone da empresa)', () => {
  it('due_at.iso reflete um instante real e consistente com a data+hora local calculada', () => {
    const result = resolveFollowUpTemplateDueAt({ offsetUnit: 'day', offsetValue: 1, defaultTime: '09:00' }, '', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const iso = new Date(result.iso);
    expect(iso.getFullYear()).toBe(2026);
    expect(iso.getMonth()).toBe(7); // agosto, 0-indexado
    expect(iso.getDate()).toBe(21);
    expect(iso.getHours()).toBe(9);
    expect(iso.getMinutes()).toBe(0);
  });
});

describe('formatFollowUpDueAtPreview', () => {
  it('mesmo dia: "Hoje às HH:MM"', () => {
    expect(formatFollowUpDueAtPreview('2026-08-20', '15:30', NOW)).toBe('Hoje às 15:30');
  });

  it('dia seguinte: "Amanhã às HH:MM"', () => {
    expect(formatFollowUpDueAtPreview('2026-08-21', '09:00', NOW)).toBe('Amanhã às 09:00');
  });

  it('data distante: DD/MM/AAAA às HH:MM, nunca em dash', () => {
    const text = formatFollowUpDueAtPreview('2026-08-27', '10:00', NOW);
    expect(text).toBe('27/08/2026 às 10:00');
    expect(text).not.toContain('—');
  });
});
