// lib/server/whatsapp-inbox/inbox-rpc.ts — W2B-8: adaptador service_role das RPCs de
// leitura da inbox. SERVER-ONLY. As linhas trazem ciphertext e só existem em memória,
// até inbox-view.ts decifrar. Erros viram códigos internos, sem texto do banco, e a
// RPC ainda não aplicada no banco vira `unavailable`.
import { createAdminClient } from '@/lib/server/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type WhatsAppInboxRpcFailure = 'forbidden' | 'conversation_not_found' | 'invalid_input' | 'unavailable';

export type WhatsAppInboxRpcResult<T> = { ok: true; rows: T[] } | { ok: false; reason: WhatsAppInboxRpcFailure };

export interface WhatsAppInboxConversationRow {
  conversationId: string;
  lastMessageAt: string;
  messageCount: number;
  piiCiphertext: string;
  piiRef: string;
  piiKeyVersion: number;
  lastConnectionId: string;
  lastMessageType: string;
  lastMessageIdHash: string;
  lastContentCiphertext: string;
  lastContentKeyVersion: number;
}

export interface WhatsAppInboxMessageRow {
  messageId: string;
  connectionId: string;
  messageType: string;
  messageIdHash: string;
  contentCiphertext: string;
  contentKeyVersion: number;
  occurredAt: string;
  receivedAt: string;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function failureFrom(message: unknown): WhatsAppInboxRpcFailure {
  if (message === 'forbidden' || message === 'conversation_not_found' || message === 'invalid_input') return message;
  return 'unavailable';
}

function toConversationRow(row: Record<string, unknown>): WhatsAppInboxConversationRow | null {
  const {
    out_conversation_id: conversationId,
    out_last_message_at: lastMessageAt,
    out_message_count: messageCount,
    out_pii_ciphertext: piiCiphertext,
    out_pii_ref: piiRef,
    out_pii_key_version: piiKeyVersion,
    out_last_connection_id: lastConnectionId,
    out_last_message_type: lastMessageType,
    out_last_message_id_hash: lastMessageIdHash,
    out_last_content_ciphertext: lastContentCiphertext,
    out_last_content_key_version: lastContentKeyVersion,
  } = row;
  if (
    !isUuid(conversationId) ||
    !isText(lastMessageAt) ||
    !isCount(messageCount) ||
    !isText(piiCiphertext) ||
    !isUuid(piiRef) ||
    !isCount(piiKeyVersion) ||
    !isUuid(lastConnectionId) ||
    !isText(lastMessageType) ||
    !isText(lastMessageIdHash) ||
    !isText(lastContentCiphertext) ||
    !isCount(lastContentKeyVersion)
  ) {
    return null;
  }
  return {
    conversationId,
    lastMessageAt,
    messageCount,
    piiCiphertext,
    piiRef,
    piiKeyVersion,
    lastConnectionId,
    lastMessageType,
    lastMessageIdHash,
    lastContentCiphertext,
    lastContentKeyVersion,
  };
}

function toMessageRow(row: Record<string, unknown>): WhatsAppInboxMessageRow | null {
  const {
    out_message_id: messageId,
    out_connection_id: connectionId,
    out_message_type: messageType,
    out_message_id_hash: messageIdHash,
    out_content_ciphertext: contentCiphertext,
    out_content_key_version: contentKeyVersion,
    out_occurred_at: occurredAt,
    out_received_at: receivedAt,
  } = row;
  if (
    !isUuid(messageId) ||
    !isUuid(connectionId) ||
    !isText(messageType) ||
    !isText(messageIdHash) ||
    !isText(contentCiphertext) ||
    !isCount(contentKeyVersion) ||
    !isText(occurredAt) ||
    !isText(receivedAt)
  ) {
    return null;
  }
  return { messageId, connectionId, messageType, messageIdHash, contentCiphertext, contentKeyVersion, occurredAt, receivedAt };
}

// Linha fora do contrato invalida a resposta inteira: nunca devolve meia página.
function mapRows<T>(data: unknown, map: (row: Record<string, unknown>) => T | null): WhatsAppInboxRpcResult<T> {
  if (!Array.isArray(data)) return { ok: false, reason: 'unavailable' };
  const rows: T[] = [];
  for (const raw of data) {
    const row = typeof raw === 'object' && raw !== null ? map(raw as Record<string, unknown>) : null;
    if (row === null) return { ok: false, reason: 'unavailable' };
    rows.push(row);
  }
  return { ok: true, rows };
}

export async function listWhatsAppInboxConversations(input: {
  actorProfileId: string;
  companyId: string;
  limit: number;
  before: { lastMessageAt: string; id: string } | null;
}): Promise<WhatsAppInboxRpcResult<WhatsAppInboxConversationRow>> {
  try {
    const { data, error } = await createAdminClient().rpc('whatsapp_inbox_list_conversations', {
      p_actor_profile_id: input.actorProfileId,
      p_company_id: input.companyId,
      p_limit: input.limit,
      p_before_last_message_at: input.before?.lastMessageAt ?? undefined,
      p_before_id: input.before?.id ?? undefined,
    });
    if (error) return { ok: false, reason: failureFrom(error.message) };
    return mapRows(data, toConversationRow);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listWhatsAppInboxMessages(input: {
  actorProfileId: string;
  companyId: string;
  conversationId: string;
  limit: number;
  before: { occurredAt: string; receivedAt: string; id: string } | null;
}): Promise<WhatsAppInboxRpcResult<WhatsAppInboxMessageRow>> {
  try {
    const { data, error } = await createAdminClient().rpc('whatsapp_inbox_list_messages', {
      p_actor_profile_id: input.actorProfileId,
      p_company_id: input.companyId,
      p_conversation_id: input.conversationId,
      p_limit: input.limit,
      p_before_occurred_at: input.before?.occurredAt ?? undefined,
      p_before_received_at: input.before?.receivedAt ?? undefined,
      p_before_id: input.before?.id ?? undefined,
    });
    if (error) return { ok: false, reason: failureFrom(error.message) };
    return mapRows(data, toMessageRow);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
