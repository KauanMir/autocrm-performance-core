// lib/leads/leadEventMapper.ts — achatamento puro de LeadHealthEvent (evento
// local de saúde, lib/services.ts) para lead_event_type (enum remoto real,
// database.types.ts). M1-E E5-A1.
//
// Reutiliza o LeadHealthEvent REAL (nenhuma união duplicada) e o tipo do
// enum gerado pelo Supabase (nenhuma string ampla, nenhum `any`, nenhum
// cast). A correspondência de cada variante foi provada byte-a-byte contra
// o mapeamento real de apply_lead_event (urgency/alert_label/
// last_activity_label) em supabase/tests/04_m1e_move_event.sql durante a
// auditoria E5-A0 — nenhum valor aqui é inventado ou aproximado.
//
// Exaustivo por construção: cada `default` inalcançável atribui o resíduo a
// uma variável `never`, então remover ou adicionar uma variante em
// LeadHealthEvent (ou no seu discriminador `outcome`) quebra a compilação
// aqui em vez de cair silenciosamente num fallback. Nenhum fallback é
// aceito — um evento sem correspondência real (ex.: "Criar acompanhamento",
// que não tem NENHUM LeadHealthEvent hoje) simplesmente não compila como
// entrada desta função, nunca é adivinhado.
import type { LeadHealthEvent } from '@/lib/services';
import type { Database } from '@/lib/supabase/database.types';

export type RemoteLeadEventType = Database['public']['Enums']['lead_event_type'];

export function mapLeadHealthEventToRemoteEventType(event: LeadHealthEvent): RemoteLeadEventType {
  switch (event.type) {
    case 'call':
      switch (event.outcome) {
        case 'visita':
          return 'call_outcome_visit';
        case 'proposta':
          return 'call_outcome_proposal';
        case 'retorno':
          return 'call_outcome_callback';
        case 'naoatendeu':
          return 'call_outcome_no_answer';
        default: {
          const exhaustiveOutcome: never = event.outcome;
          throw new Error(`mapLeadHealthEventToRemoteEventType: outcome de 'call' sem mapeamento: ${String(exhaustiveOutcome)}`);
        }
      }

    case 'visit_scheduled':
      return event.hasDate && event.hasTime ? 'visit_scheduled_complete' : 'visit_scheduled_incomplete';

    case 'visit_confirmed':
      return 'visit_confirmed';

    case 'visit_canceled':
      return 'visit_canceled';

    case 'visit_rescheduled':
      return 'visit_rescheduled';

    case 'deal_created':
      return event.needsApproval ? 'deal_created_needs_approval' : 'deal_created_direct';

    case 'deal_approved':
      return 'deal_approved';

    case 'deal_rejected':
      return 'deal_rejected';

    case 'sale_registered':
      return 'sale_registered';

    case 'sale_canceled':
      return 'sale_canceled';

    case 'visit_result_done':
      return 'visit_result_done';

    case 'visit_result_thinking':
      return 'visit_result_thinking';

    case 'visit_result_no_interest':
      return 'visit_result_no_interest';

    default: {
      const exhaustiveEvent: never = event;
      throw new Error(`mapLeadHealthEventToRemoteEventType: LeadHealthEvent sem mapeamento remoto: ${JSON.stringify(exhaustiveEvent)}`);
    }
  }
}
