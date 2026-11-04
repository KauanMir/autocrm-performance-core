// lib/server/whatsapp-connection/connection-rpc.ts — adaptador service_role
// para as RPCs de whatsapp_connections. SERVER-ONLY. Reutiliza
// createAdminClient(). Erros do Supabase são reduzidos a código/mensagem
// internos — quem consome compara códigos conhecidos e nunca os devolve ao
// browser. lookup_for_processing (única RPC com ciphertext) fica de fora até
// a W2B precisar dela.
import { createAdminClient } from '@/lib/server/supabase/admin';

export interface RpcFailure {
  code?: string;
  message?: string;
}

export interface WhatsAppUpsertRpcArgs {
  p_company_id: string;
  p_waba_id: string;
  p_phone_number_id: string;
  p_display_phone_number: string | null;
  p_access_token_ciphertext: string;
  p_token_key_version: number;
  p_connected_at: string;
  p_connected_by: string | null;
}

export interface WhatsAppConnectionRow {
  id: string;
  company_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  status: string;
  connected_at: string;
}

export interface WhatsAppOwnerRow {
  connection_id: string;
  company_id: string;
  status: string;
}

export interface WhatsAppConnectionRpcPort {
  upsert(args: WhatsAppUpsertRpcArgs): Promise<{ data: WhatsAppConnectionRow[] | null; error: RpcFailure | null }>;
  ownerByPhoneNumber(phoneNumberId: string): Promise<{ data: WhatsAppOwnerRow[] | null; error: RpcFailure | null }>;
}

function toRpcFailure(error: { code?: string; message?: string } | null): RpcFailure | null {
  return error ? { code: error.code, message: error.message } : null;
}

// Saúde da conexão para o diagnóstico (W2B-2). Só estes campos: WABA, número e
// número exibido, que a RPC também devolve, são descartados aqui e nunca saem
// deste adaptador.
export interface WhatsAppConnectionHealthRow {
  status: string;
  connected_at: string | null;
  disconnected_at: string | null;
  last_error_code: string | null;
}

export async function fetchWhatsAppConnectionHealth(
  companyId: string,
): Promise<{ data: WhatsAppConnectionHealthRow[] | null; error: RpcFailure | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('whatsapp_connection_status', { p_company_id: companyId });
  if (error) return { data: null, error: toRpcFailure(error) };
  return {
    data: (data ?? []).map((row) => ({
      status: row.status,
      connected_at: row.connected_at,
      disconnected_at: row.disconnected_at,
      last_error_code: row.last_error_code,
    })),
    error: null,
  };
}

export function createWhatsAppConnectionRpcPort(): WhatsAppConnectionRpcPort {
  const admin = createAdminClient();
  return {
    async upsert(args) {
      const { data, error } = await admin.rpc('whatsapp_connection_upsert', args);
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    async ownerByPhoneNumber(phoneNumberId) {
      const { data, error } = await admin.rpc('whatsapp_connection_owner_by_phone_number', {
        p_phone_number_id: phoneNumberId,
      });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
  };
}
