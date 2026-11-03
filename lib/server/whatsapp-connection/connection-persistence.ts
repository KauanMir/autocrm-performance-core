// lib/server/whatsapp-connection/connection-persistence.ts — persiste a
// conexão WhatsApp de UMA company: cifra o access token (chave própria do
// WhatsApp, AAD company + phone_number_id) e chama whatsapp_connection_upsert.
// SERVER-ONLY. Sem rota/UI nesta fase (W2A): quem chamará é o fluxo de
// Embedded Signup (futuro), depois de decidir a autorização.
//
// Nunca devolve token nem ciphertext; erros são códigos fixos.
import {
  createWhatsAppConnectionRpcPort,
  type WhatsAppConnectionRpcPort,
} from './connection-rpc';
import {
  encryptWhatsAppAccessToken,
  getWhatsAppTokenKeyForVersion,
  WHATSAPP_TOKEN_KEY_VERSION,
} from './token-crypto';

export interface PersistWhatsAppConnectionInput {
  companyId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  accessToken: string;
  connectedBy: string | null;
  connectedAt?: Date;
}

export interface PersistedWhatsAppConnection {
  connectionId: string;
  companyId: string;
  status: string;
}

export type PersistWhatsAppConnectionErrorCode =
  | 'key_unavailable'
  | 'encrypt_failed'
  | 'phone_number_already_connected'
  | 'invalid_input'
  | 'persist_failed';

export type PersistWhatsAppConnectionResult =
  | { ok: true; value: PersistedWhatsAppConnection }
  | { ok: false; code: PersistWhatsAppConnectionErrorCode };

export interface PersistWhatsAppConnectionDeps {
  rpc: () => WhatsAppConnectionRpcPort;
  getKey: (keyVersion: number) => Buffer;
}

const defaultDeps: PersistWhatsAppConnectionDeps = {
  rpc: createWhatsAppConnectionRpcPort,
  getKey: getWhatsAppTokenKeyForVersion,
};

export async function persistWhatsAppConnection(
  input: PersistWhatsAppConnectionInput,
  deps: PersistWhatsAppConnectionDeps = defaultDeps,
): Promise<PersistWhatsAppConnectionResult> {
  let key: Buffer;
  try {
    key = deps.getKey(WHATSAPP_TOKEN_KEY_VERSION);
  } catch {
    return { ok: false, code: 'key_unavailable' };
  }

  let ciphertext: string;
  try {
    ciphertext = encryptWhatsAppAccessToken({
      companyId: input.companyId,
      phoneNumberId: input.phoneNumberId,
      keyVersion: WHATSAPP_TOKEN_KEY_VERSION,
      plaintextToken: input.accessToken,
      key,
    });
  } catch {
    return { ok: false, code: 'encrypt_failed' };
  }

  try {
    const { data, error } = await deps.rpc().upsert({
      p_company_id: input.companyId,
      p_waba_id: input.wabaId,
      p_phone_number_id: input.phoneNumberId,
      p_display_phone_number: input.displayPhoneNumber,
      p_access_token_ciphertext: ciphertext,
      p_token_key_version: WHATSAPP_TOKEN_KEY_VERSION,
      p_connected_at: (input.connectedAt ?? new Date()).toISOString(),
      p_connected_by: input.connectedBy,
    });
    if (error) {
      if (error.message === 'phone_number_already_connected') {
        return { ok: false, code: 'phone_number_already_connected' };
      }
      if (error.message === 'invalid_input') return { ok: false, code: 'invalid_input' };
      return { ok: false, code: 'persist_failed' };
    }
    const row = data?.[0];
    if (!row?.id) return { ok: false, code: 'persist_failed' };
    return { ok: true, value: { connectionId: row.id, companyId: row.company_id, status: row.status } };
  } catch {
    return { ok: false, code: 'persist_failed' };
  }
}
