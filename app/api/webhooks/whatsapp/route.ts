// app/api/webhooks/whatsapp/route.ts — webhook OFICIAL da WhatsApp Cloud API
// (objeto whatsapp_business_account, field messages). Rota PÚBLICA por
// necessidade: a Meta chama de fora, sem sessão do CRM. A proteção é o
// verify token (GET) e o HMAC SHA-256 do X-Hub-Signature-256 (POST), com o
// App Secret do app Meta (mesmo mecanismo de /api/webhooks/meta).
//
// FASE W1 — só fundação. Esta rota e lib/server/whatsapp-webhook/* são
// infraestrutura isolada: NÃO escreve no banco, NÃO chama a Graph API, NÃO
// cria conversa/lead/tarefa, NÃO toca Meta Lead Ads, cron, pilotos nem
// nenhuma company. Só valida, classifica (message_received / message_status
// / ignorado) e loga metadados booleanos. Ver docs/WHATSAPP-CLOUD-API.md.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  getWhatsAppAppSecret,
  getWhatsAppWebhookVerifyToken,
  MissingWhatsAppWebhookEnvError,
} from '@/lib/server/whatsapp-webhook/env';
import { parseWhatsAppWebhookPayload } from '@/lib/server/whatsapp-webhook/events';
import { logWhatsAppWebhookError, logWhatsAppWebhookEvent } from '@/lib/server/whatsapp-webhook/logger';
// Função pura (HMAC + timingSafeEqual), sem I/O nem estado: reaproveitada
// em vez de duplicada. Não traz nenhum comportamento do Lead Ads junto.
import { verifyMetaSignature } from '@/lib/server/meta-webhook/signature';

export const runtime = 'nodejs';
// Um webhook nunca pode ser servido de cache: cada handshake/evento é
// único. Escopo estrito desta rota — não afeta nenhuma outra.
export const dynamic = 'force-dynamic';

// Teto de linhas de log por evento numa única entrega; o resumo final
// sempre traz as contagens completas.
const MAX_EVENT_LOG_LINES = 50;

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Comparação de strings em tempo ~constante para o verify token. Se os
// comprimentos diferem, ainda faz um compare de custo fixo e devolve false
// (não revela a divergência de tamanho por timing).
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// ── GET: handshake de verificação do webhook ───────────────────────────
export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();

  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  let verifyToken: string;
  try {
    verifyToken = getWhatsAppWebhookVerifyToken();
  } catch (error) {
    if (error instanceof MissingWhatsAppWebhookEnvError) {
      logWhatsAppWebhookError('verify_token_env_missing', requestId);
      return textResponse(500, 'server misconfigured');
    }
    throw error;
  }

  if (mode === null || token === null || challenge === null) {
    logWhatsAppWebhookEvent({ requestId, phase: 'verify', result: 'missing_params' });
    return textResponse(400, 'bad request');
  }

  if (mode !== 'subscribe' || !timingSafeStringEqual(token, verifyToken)) {
    logWhatsAppWebhookEvent({ requestId, phase: 'verify', result: 'rejected' });
    return textResponse(403, 'forbidden');
  }

  // Válido: ecoa o challenge em texto puro, HTTP 200. Nunca devolve o
  // verify token.
  logWhatsAppWebhookEvent({ requestId, phase: 'verify', result: 'ok' });
  return textResponse(200, challenge);
}

// ── POST: recebimento de eventos ──────────────────────────────────────
export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let appSecret: string;
  try {
    appSecret = getWhatsAppAppSecret();
  } catch (error) {
    if (error instanceof MissingWhatsAppWebhookEnvError) {
      logWhatsAppWebhookError('app_secret_env_missing', requestId);
      // Sem o segredo não há como validar a assinatura — falha fechado.
      return textResponse(500, 'server misconfigured');
    }
    throw error;
  }

  // RAW BODY antes de qualquer parse — o HMAC é sobre os bytes exatos.
  const rawBody = await request.text();

  const signature = verifyMetaSignature(
    request.headers.get('x-hub-signature-256'),
    rawBody,
    appSecret,
  );
  if (!signature.ok) {
    // `in` em vez de narrowing pelo discriminante (tsconfig strict:false).
    const reason = 'reason' in signature ? signature.reason : 'invalid';
    logWhatsAppWebhookEvent({ requestId, phase: 'event', result: `signature_${reason}` });
    return textResponse(403, 'forbidden');
  }

  // Só depois de assinatura válida: parse do JSON. Corpo vazio vira null
  // (ignorado com 200); JSON inválido → 400.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.trim() === '' ? 'null' : rawBody);
  } catch {
    logWhatsAppWebhookEvent({ requestId, phase: 'event', result: 'invalid_json' });
    return textResponse(400, 'bad request');
  }

  const parsed = parseWhatsAppWebhookPayload(payload);

  // Outro objeto (ou payload vazio/sem object): ignorado com segurança, 200.
  // O valor de `object` não é logado — pode ser string arbitrária.
  if (!parsed.isWhatsAppBusinessAccount) {
    logWhatsAppWebhookEvent({
      requestId,
      phase: 'event',
      result: 'ignored_non_whatsapp',
      eventType: 'ignored',
      durationMs: Date.now() - startedAt,
    });
    return textResponse(200, 'ok');
  }

  let messageReceivedCount = 0;
  let messageStatusCount = 0;
  parsed.events.forEach((event, index) => {
    if (event.eventType === 'message_received') messageReceivedCount += 1;
    else messageStatusCount += 1;
    if (index >= MAX_EVENT_LOG_LINES) return;
    logWhatsAppWebhookEvent({
      requestId,
      phase: 'event',
      result: 'classified',
      eventType: event.eventType,
      hasPhoneNumberId: event.hasPhoneNumberId,
      hasMessageId: event.hasMessageId,
      messageType: event.messageType,
      status: event.status,
      hasErrors: event.hasErrors,
    });
  });

  // W1: nada é persistido nem processado — só o resumo e 200 rápido.
  logWhatsAppWebhookEvent({
    requestId,
    phase: 'event',
    result: parsed.events.length > 0 ? 'accepted' : 'ignored_no_events',
    messageReceivedCount,
    messageStatusCount,
    ignoredChangeCount: parsed.ignoredChangeCount,
    durationMs: Date.now() - startedAt,
  });
  return textResponse(200, 'ok');
}
