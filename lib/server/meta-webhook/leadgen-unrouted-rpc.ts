// lib/server/meta-webhook/leadgen-unrouted-rpc.ts — META-MVP2. SERVER-ONLY.
// Retenção de eventos leadgen sem dono (Página sem conexão utilizável, empresa
// desligada ou posse ambígua). Só metadados técnicos, sem empresa: reter o
// evento não decide de quem ele é. A liberação é ato do Super Admin
// (meta_leadgen_unrouted_adopt).
import { createAdminClient } from '@/lib/server/supabase/admin';

export type UnroutedReason = 'no_connection' | 'company_disabled' | 'ambiguous_owner';

export interface RecordUnroutedEventInput {
  pageId: string;
  leadgenId: string;
  formId: string | null;
  reason: UnroutedReason;
  receivedAt: Date;
}

export async function recordUnroutedLeadgenEvent(input: RecordUnroutedEventInput): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await createAdminClient().rpc('meta_leadgen_unrouted_record', {
      p_page_id: input.pageId,
      p_leadgen_id: input.leadgenId,
      p_reason: input.reason,
      p_received_at: input.receivedAt.toISOString(),
      p_form_id: input.formId ?? undefined,
    });
    return { ok: !error && Array.isArray(data) && data.length === 1 };
  } catch {
    return { ok: false };
  }
}
