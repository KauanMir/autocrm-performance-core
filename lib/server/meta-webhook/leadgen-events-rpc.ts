// lib/server/meta-webhook/leadgen-events-rpc.ts — adaptador service_role para
// o registro idempotente de eventos leadgen. SERVER-ONLY. Reutiliza
// createAdminClient(). Não busca lead, não decifra token, não grava PII.
import { createAdminClient } from '@/lib/server/supabase/admin';

export interface RegisterLeadgenEventInput {
  integrationId: string;
  companyId: string;
  pageId: string;
  leadgenId: string;
  formId: string | null;
  receivedAt: Date;
}

export interface RegisterLeadgenEventResult {
  eventId: string;
  status: string;
  created: boolean;
}

export type RegisterLeadgenEventFailure = { ok: false; code: 'register_failed' };

export async function registerLeadgenEvent(
  input: RegisterLeadgenEventInput,
): Promise<{ ok: true; value: RegisterLeadgenEventResult } | RegisterLeadgenEventFailure> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('meta_leadgen_event_register', {
      p_integration_id: input.integrationId,
      p_company_id: input.companyId,
      p_page_id: input.pageId,
      p_leadgen_id: input.leadgenId,
      p_form_id: input.formId ?? undefined,
      p_received_at: input.receivedAt.toISOString(),
    });
    const row = data?.[0];
    if (error || !row || !row.out_event_id) {
      return { ok: false, code: 'register_failed' };
    }
    return {
      ok: true,
      value: { eventId: row.out_event_id, status: row.out_status, created: row.out_created === true },
    };
  } catch {
    return { ok: false, code: 'register_failed' };
  }
}
