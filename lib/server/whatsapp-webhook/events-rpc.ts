// lib/server/whatsapp-webhook/events-rpc.ts — adaptador service_role para o
// registro idempotente no ledger whatsapp_webhook_events. SERVER-ONLY.
// Reutiliza createAdminClient(). Recebe só o hash do wamid, nunca o cru.
import { createAdminClient } from '@/lib/server/supabase/admin';

export interface RegisterWhatsAppEventInput {
  connectionId: string;
  companyId: string;
  phoneNumberId: string;
  eventKind: 'message' | 'status';
  messageIdHash: string;
  messageType: string | null;
  statusValue: string | null;
  // SHA-256 do status bruto (só status); o valor bruto nunca vem para cá.
  statusKeyHash: string | null;
  occurredAt: Date | null;
  receivedAt: Date;
}

export type RegisterWhatsAppEventResult =
  | { ok: true; value: { eventId: string; created: boolean } }
  | { ok: false; code: 'register_failed' };

export async function registerWhatsAppEvent(input: RegisterWhatsAppEventInput): Promise<RegisterWhatsAppEventResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('whatsapp_webhook_event_register', {
      p_connection_id: input.connectionId,
      p_company_id: input.companyId,
      p_phone_number_id: input.phoneNumberId,
      p_event_kind: input.eventKind,
      p_message_id_hash: input.messageIdHash,
      p_message_type: input.messageType ?? undefined,
      p_status_value: input.statusValue ?? undefined,
      p_status_key_hash: input.statusKeyHash ?? undefined,
      p_occurred_at: input.occurredAt?.toISOString(),
      p_received_at: input.receivedAt.toISOString(),
    });
    const row = data?.[0];
    if (error || !row || !row.out_event_id) {
      return { ok: false, code: 'register_failed' };
    }
    return { ok: true, value: { eventId: row.out_event_id, created: row.out_created === true } };
  } catch {
    return { ok: false, code: 'register_failed' };
  }
}
