// app/api/integrations/whatsapp/inbox/conversations/[conversationId]/messages/route.ts
// W2B-8. GET somente leitura com as mensagens de uma conversa da TEST COMPANY. A RPC
// responde igual para conversa de outra empresa e conversa inexistente. A página vai
// em ordem cronológica; `nextCursor` aponta para as mensagens mais antigas.
import { randomUUID } from 'node:crypto';
import { isValidUuid, jsonResponse } from '@/lib/server/invites/http';
import { getWhatsAppContentEncryptionKeyV1 } from '@/lib/server/whatsapp-connection/env';
import { authorizeWhatsAppInboxRead } from '@/lib/server/whatsapp-inbox/authorize';
import { listWhatsAppInboxMessages } from '@/lib/server/whatsapp-inbox/inbox-rpc';
import { decodeMessageCursor, encodeMessageCursor, toMessageView } from '@/lib/server/whatsapp-inbox/inbox-view';
import { logWhatsAppInbox } from '@/lib/server/whatsapp-inbox/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

export async function GET(request: Request, context: { params: { conversationId: string } }): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const log = (result: string, counts: { returned?: number; unreadable?: number } = {}) =>
    logWhatsAppInbox({ requestId, operation: 'messages', result, ...counts, durationMs: Date.now() - startedAt });

  const access = await authorizeWhatsAppInboxRead(request);
  if (access.ok === false) {
    log(access.logResult);
    return errorResponse(access.status, access.error);
  }

  const conversationId = context.params.conversationId;
  if (!isValidUuid(conversationId)) {
    log('invalid_conversation');
    return errorResponse(400, 'invalid_request');
  }

  const rawCursor = new URL(request.url).searchParams.get('cursor');
  const before = rawCursor === null ? null : decodeMessageCursor(rawCursor);
  if (rawCursor !== null && before === null) {
    log('invalid_cursor');
    return errorResponse(400, 'invalid_request');
  }

  const result = await listWhatsAppInboxMessages({
    actorProfileId: access.actorProfileId,
    companyId: access.companyId,
    conversationId: conversationId.toLowerCase(),
    limit: PAGE_SIZE + 1,
    before,
  });
  if (result.ok === false) {
    log(result.reason);
    if (result.reason === 'forbidden') return errorResponse(403, 'forbidden');
    if (result.reason === 'conversation_not_found') return errorResponse(404, 'conversation_not_found');
    return errorResponse(503, 'inbox_unavailable');
  }

  const page = result.rows.slice(0, PAGE_SIZE);
  const nextCursor = result.rows.length > PAGE_SIZE ? encodeMessageCursor(page[page.length - 1]) : null;
  if (page.length === 0) {
    log('completed');
    return jsonResponse(200, { ok: true, messages: [], nextCursor: null });
  }

  let key: Buffer;
  try {
    key = getWhatsAppContentEncryptionKeyV1();
  } catch {
    log('content_key_invalid');
    return errorResponse(503, 'inbox_unavailable');
  }

  try {
    const messages = page.map((row) => toMessageView(row, access.companyId, key)).reverse();
    const unreadable = messages.filter((item) => item.body.kind === 'unreadable').length;
    log('completed', { returned: messages.length, unreadable });
    return jsonResponse(200, { ok: true, messages, nextCursor });
  } finally {
    key.fill(0);
  }
}
