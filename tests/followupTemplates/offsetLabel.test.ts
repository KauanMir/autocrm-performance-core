// Testes de formatFollowUpTemplateSubtitle (FOLLOW-UP-TEMPLATES-A3-EXEC
// precheck §21) — exemplos congelados exatos do precheck: "Em 1 hora",
// "Amanhã às 10:00", "Em 3 dias às 09:00", "Em 7 dias". Puro.
import { describe, expect, it } from 'vitest';
import { formatFollowUpTemplateSubtitle } from '@/lib/followupTemplates/offsetLabel';

describe('formatFollowUpTemplateSubtitle', () => {
  it('1 hora: "Em 1 hora" (singular, nunca horário — hour nunca tem default_time)', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'hour', offsetValue: 1, defaultTime: null })).toBe('Em 1 hora');
  });

  it('N horas: "Em N horas" (plural)', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'hour', offsetValue: 3, defaultTime: null })).toBe('Em 3 horas');
  });

  it('1 dia com horário: "Amanhã às HH:MM" (nunca "Em 1 dia")', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'day', offsetValue: 1, defaultTime: '10:00' })).toBe('Amanhã às 10:00');
  });

  it('1 dia sem horário: "Amanhã" (sem sufixo)', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'day', offsetValue: 1, defaultTime: null })).toBe('Amanhã');
  });

  it('N dias com horário: "Em N dias às HH:MM"', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'day', offsetValue: 3, defaultTime: '09:00' })).toBe('Em 3 dias às 09:00');
  });

  it('N dias sem horário: "Em N dias" (sem sufixo)', () => {
    expect(formatFollowUpTemplateSubtitle({ offsetUnit: 'day', offsetValue: 7, defaultTime: null })).toBe('Em 7 dias');
  });

  it('nunca expõe offset_value/offset_unit/HH:mm cru como termo técnico', () => {
    const text = formatFollowUpTemplateSubtitle({ offsetUnit: 'day', offsetValue: 3, defaultTime: '09:00' });
    expect(text).not.toMatch(/offset|day|hour/i);
  });
});
