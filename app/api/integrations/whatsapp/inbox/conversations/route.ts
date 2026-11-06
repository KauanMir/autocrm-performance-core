// app/api/integrations/whatsapp/inbox/conversations/route.ts — W2B-8. GET somente
// leitura com as conversas da TEST COMPANY. Portão em lib/server/whatsapp-inbox/
// authorize.ts. Decifra só no servidor e devolve o DTO fechado de inbox-view.ts.
import { randomUUID } from 'node:crypto';
import { jsonResponse } from '@/lib/server/invites/http';
import { getWhatsAppContentEncryptionKeyV1 } from '@/lib/server/whatsapp-connection/env';
import { authorizeWhatsAppInboxRead } from '@/lib/server/whatsapp-inbox/authorize';
import { listWhatsAppInboxConversations } from '@/lib/server/whatsapp-inbox/inbox-rpc';
import {
  decodeConversationCursor,
  encodeConversationCursor,
  toConversationView,
} from '@/lib/server/whatsapp-inbox/inbox-view';
import { logWhatsAppInbox } from '@/lib/server/whatsapp-inbox/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { ok: false, error });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const log = (result: string, counts: { returned?: number; unreadable?: number } = {}) =>
    logWhatsAppInbox({ requestId, operation: 'conversations', result, ...counts, durationMs: Date.now() - startedAt });

  const access = await authorizeWhatsAppInboxRead(request);
  if (access.ok === false) {
    log(access.logResult);
    return errorResponse(access.status, access.error);
  }

  const rawCursor = new URL(request.url).searchParams.get('cursor');
  const before = rawCursor === null ? null : decodeConversationCursor(rawCursor);
  if (rawCursor !== null && before === null) {
    log('invalid_cursor');
    return errorResponse(400, 'invalid_request');
  }

  // Uma linha a mais só para saber se existe próxima página.
  const result = await listWhatsAppInboxConversations({
    actorProfileId: access.actorProfileId,
    companyId: access.companyId,
    limit: PAGE_SIZE + 1,
    before,
  });
  if (result.ok === false) {
    log(result.reason);
    if (result.reason === 'forbidden') return errorResponse(403, 'forbidden');
    return errorResponse(503, 'inbox_unavailable');
  }

  const page = result.rows.slice(0, PAGE_SIZE);
  const nextCursor = result.rows.length > PAGE_SIZE ? encodeConversationCursor(page[page.length - 1]) : null;
  if (page.length === 0) {
    log('completed');
    return jsonResponse(200, { ok: true, conversations: [], nextCursor: null });
  }

  let key: Buffer;
  try {
    key = getWhatsAppContentEncryptionKeyV1();
  } catch {
    log('content_key_invalid');
    return errorResponse(503, 'inbox_unavailable');
  }

  try {
    const conversations = page.map((row) => toConversationView(row, access.companyId, key));
    const unreadable = conversations.filter(
      (item) => !item.contact.readable || item.preview.kind === 'unreadable',
    ).length;
    log('completed', { returned: conversations.length, unreadable });
    return jsonResponse(200, { ok: true, conversations, nextCursor });
  } finally {
    key.fill(0);
  }
}
