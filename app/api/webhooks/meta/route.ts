// app/api/webhooks/meta/route.ts — webhook OFICIAL da Meta (Marketing API
// / produto Webhooks; objeto Page, campo leadgen). Rota PÚBLICA por
// necessidade: a Meta chama de fora, sem sessão do CRM. A proteção é o
// verify token (GET) e o HMAC SHA-256 do X-Hub-Signature-256 (POST).
//
// ISOLAMENTO (regra crítica desta etapa): esta rota e o módulo
// lib/server/meta-webhook/ são infraestrutura isolada. NÃO cria lead, NÃO
// consulta Graph API, NÃO toca pipeline/telas/ranking/automação/
// notificação, NÃO escreve no banco, NÃO altera dado de nenhuma company
// existente. O único efeito colateral do POST é uma linha de log redigida.
//
// IDEMPOTÊNCIA: não implementada nesta fase, de propósito — nada é
// persistido. Quando começarmos a criar leads reais, será OBRIGATÓRIO
// deduplicar por leadgen_id (ou identificador equivalente) antes de
// qualquer escrita. Ver docs/META-WEBHOOK.md.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  getMetaAppSecret,
  getMetaWebhookVerifyToken,
  MissingMetaWebhookEnvError,
} from '@/lib/server/meta-webhook/env';
import { verifyMetaSignature } from '@/lib/server/meta-webhook/signature';
import { parseMetaWebhookPayload } from '@/lib/server/meta-webhook/events';
import { logMetaWebhookEvent, logMetaWebhookError } from '@/lib/server/meta-webhook/logger';

export const runtime = 'nodejs';
// Um webhook nunca pode ser servido de cache: cada handshake/evento é
// único. Escopo estrito desta rota — não afeta nenhuma outra.
export const dynamic = 'force-dynamic';

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
    verifyToken = getMetaWebhookVerifyToken();
  } catch (error) {
    if (error instanceof MissingMetaWebhookEnvError) {
      logMetaWebhookError('verify_token_env_missing', { requestId });
      return textResponse(500, 'server misconfigured');
    }
    throw error;
  }

  if (mode === null || token === null || challenge === null) {
    logMetaWebhookEvent({ requestId, operation: 'verify', result: 'missing_params' });
    return textResponse(400, 'bad request');
  }

  if (mode !== 'subscribe' || !timingSafeStringEqual(token, verifyToken)) {
    logMetaWebhookEvent({ requestId, operation: 'verify', result: 'rejected' });
    return textResponse(403, 'forbidden');
  }

  // Válido: ecoa o challenge em texto puro, HTTP 200. Nunca devolve o
  // verify token.
  logMetaWebhookEvent({ requestId, operation: 'verify', result: 'ok' });
  return textResponse(200, challenge);
}

// ── POST: recebimento de eventos ──────────────────────────────────────
export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let appSecret: string;
  try {
    appSecret = getMetaAppSecret();
  } catch (error) {
    if (error instanceof MissingMetaWebhookEnvError) {
      logMetaWebhookError('app_secret_env_missing', { requestId });
      // Sem o segredo não há como validar a assinatura — falha fechado.
      return textResponse(500, 'server misconfigured');
    }
    throw error;
  }

  // (1) RAW BODY antes de qualquer parse — obrigatório para validar o HMAC
  // sobre os bytes exatos recebidos.
  const rawBody = await request.text();

  // (2)-(5) assinatura: ausente / formato inválido / incorreta → 403.
  const signature = verifyMetaSignature(
    request.headers.get('x-hub-signature-256'),
    rawBody,
    appSecret,
  );
  if (!signature.ok) {
    // `in` em vez de narrowing pelo discriminante: o tsconfig do projeto
    // roda com strict:false, onde a inferência da união discriminada por
    // `!signature.ok` não é confiável.
    const reason = 'reason' in signature ? signature.reason : 'invalid';
    logMetaWebhookEvent({ requestId, operation: 'event', result: `signature_${reason}` });
    return textResponse(403, 'forbidden');
  }

  // (7) só depois de assinatura válida: parse do JSON. Corpo vazio ou
  // inválido não derruba o processo.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.trim() === '' ? 'null' : rawBody);
  } catch {
    logMetaWebhookEvent({ requestId, operation: 'event', result: 'invalid_json' });
    return textResponse(400, 'bad request');
  }

  // (12)(13) tolerante a qualquer forma desconhecida — parse nunca lança.
  const parsed = parseMetaWebhookPayload(payload);

  // (7)(10) aceitar inicialmente somente objeto Page; outros objetos são
  // ignorados com segurança e recebem HTTP 200.
  if (!parsed.isPage) {
    logMetaWebhookEvent({
      requestId,
      operation: 'event',
      result: 'ignored_non_page',
      object: parsed.object ?? undefined,
      durationMs: Date.now() - startedAt,
    });
    return textResponse(200, 'ok');
  }

  // (8) eventos leadgen: registrar SOMENTE metadados técnicos mínimos
  // (page_id, form_id, leadgen_id, created_time). Nunca nome, telefone,
  // e-mail, respostas do formulário ou payload completo.
  for (const change of parsed.leadgenChanges) {
    logMetaWebhookEvent({
      requestId,
      operation: 'event',
      result: 'leadgen_received',
      object: 'page',
      field: 'leadgen',
      pageId: change.pageId,
      formId: change.formId,
      leadgenId: change.leadgenId,
      createdTime: change.createdTime,
    });
  }

  // (10) Page sem nenhuma mudança leadgen: ignora com segurança, 200.
  if (parsed.leadgenChanges.length === 0) {
    logMetaWebhookEvent({
      requestId,
      operation: 'event',
      result: 'ignored_page_non_leadgen',
      object: 'page',
      changeCount: parsed.otherChangeCount,
      durationMs: Date.now() - startedAt,
    });
    return textResponse(200, 'ok');
  }

  // (9) NADA além do log acima: sem Graph API, sem criar Lead, sem
  // atribuir vendedor, sem timeline/tarefa/visita/negociação, sem mexer
  // em ranking, sem notificação, sem automação, sem persistir conteúdo
  // pessoal do lead.
  // (11) resposta rápida — nenhuma operação lenta antes do 200.
  logMetaWebhookEvent({
    requestId,
    operation: 'event',
    result: 'accepted',
    object: 'page',
    field: 'leadgen',
    changeCount: parsed.leadgenChanges.length,
    durationMs: Date.now() - startedAt,
  });
  return textResponse(200, 'ok');
}
