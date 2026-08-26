// lib/followupTemplates/offsetLabel.ts — subtítulo humano de um Follow-up
// Template para o picker do Lead (precheck A3-EXEC §10/§21) — o usuário
// nunca vê offset_value/offset_unit/HH:mm cru. Puro, sem React.
//
// Exemplos congelados (precheck A3-EXEC §21): "Em 1 hora", "Amanhã às
// 10:00", "Em 3 dias às 09:00", "Em 7 dias". Dia com offset_value=1 vira
// "Amanhã" (nunca "Em 1 dia"); hora nunca mostra horário (default_time é
// sempre NULL para offset_unit='hour', constraint do A2).
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

export function formatFollowUpTemplateSubtitle(template: Pick<FollowUpTemplateModel, 'offsetUnit' | 'offsetValue' | 'defaultTime'>): string {
  const { offsetUnit, offsetValue, defaultTime } = template;

  if (offsetUnit === 'hour') {
    return offsetValue === 1 ? 'Em 1 hora' : `Em ${offsetValue} horas`;
  }

  const base = offsetValue === 1 ? 'Amanhã' : `Em ${offsetValue} dias`;
  return defaultTime ? `${base} às ${defaultTime}` : base;
}
