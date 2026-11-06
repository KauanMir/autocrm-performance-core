// lib/server/whatsapp-webhook/ingestion.ts — W2B-5: captura transacional de UMA
// entrega do webhook. SERVER-ONLY. Só roda com WHATSAPP_INGESTION_ENABLED=true.
//
// Para cada item: conexão pelo phone_number_id → gate de captura → WABA →
// cifragem → RPC transacional. Sem capture_enabled nada é gravado.
//   - dado pessoal só sai daqui cifrado; hashes e HMACs não saem em log;
//   - NÃO chama Graph e NÃO decifra token;
//   - quem chama decide o HTTP: infraFailure => 503 (a Meta reentrega e a captura
//     é idempotente); demais => 200. Falha numa captura habilitada nunca vira 200.
//
// Recusas definitivas respondem 200 e ficam contadas sem dado pessoal: WABA
// divergente, contato não identificado e mensagem de grupo. Nenhuma delas cria
// contato, conversa ou mensagem.
import { randomUUID } from 'node:crypto';
import {
  clearWhatsAppCaptureKeys,
  computeWhatsAppContactHmac,
  encryptWhatsAppContactPii,
  encryptWhatsAppMessageContent,
  loadWhatsAppCaptureKeys,
  WHATSAPP_CAPTURE_KEY_VERSION,
  type WhatsAppCaptureKeys,
} from '@/lib/server/whatsapp-connection/capture-crypto';
import {
  captureInboundMessage,
  loadWhatsAppCaptureContext,
  markInboundEventFailed,
  type CaptureInboundMessageInput,
  type InboundEventFailureCode,
  type WhatsAppCaptureContext,
} from './capture-rpc';
import { hashWhatsAppMessageId, hashWhatsAppStatusKey } from './event-hashes';
import { registerWhatsAppEvent } from './events-rpc';
import {
  parseWhatsAppInboundDelivery,
  type ParsedInboundMessage,
  type RejectedInboundMessage,
} from './inbound-parser';

export interface WhatsAppIngestionSummary {
  capturedCount: number;
  registeredCount: number;
  duplicateCount: number;
  unknownNumberCount: number;
  unusableCount: number;
  captureDisabledCount: number;
  wabaMismatchCount: number;
  failedCount: number;
  groupMessageCount: number;
  invalidTimestampCount: number;
  infraFailure: boolean;
}

export function emptyWhatsAppIngestionSummary(): WhatsAppIngestionSummary {
  return {
    capturedCount: 0,
    registeredCount: 0,
    duplicateCount: 0,
    unknownNumberCount: 0,
    unusableCount: 0,
    captureDisabledCount: 0,
    wabaMismatchCount: 0,
    failedCount: 0,
    groupMessageCount: 0,
    invalidTimestampCount: 0,
    infraFailure: false,
  };
}

export interface WhatsAppIngestionDeps {
  loadContext: typeof loadWhatsAppCaptureContext;
  capture: typeof captureInboundMessage;
  markFailed: typeof markInboundEventFailed;
  register: typeof registerWhatsAppEvent;
  loadKeys: typeof loadWhatsAppCaptureKeys;
  now: () => Date;
}

const defaultDeps = (): WhatsAppIngestionDeps => ({
  loadContext: loadWhatsAppCaptureContext,
  capture: captureInboundMessage,
  markFailed: markInboundEventFailed,
  register: registerWhatsAppEvent,
  loadKeys: loadWhatsAppCaptureKeys,
  now: () => new Date(),
});

type ContextResolution = WhatsAppCaptureContext | 'unknown' | 'infra_failure';

type Admission =
  | { kind: 'admitted'; context: WhatsAppCaptureContext }
  | { kind: 'waba_mismatch'; context: WhatsAppCaptureContext }
  | { kind: 'stopped' };

interface DeliveryState {
  summary: WhatsAppIngestionSummary;
  // Uma consulta por phone_number_id distinto por entrega.
  contexts: Map<string, ContextResolution>;
  keys: WhatsAppCaptureKeys | null;
  receivedAt: Date;
  requestId: string;
  deps: WhatsAppIngestionDeps;
}

async function resolveContext(phoneNumberId: string, state: DeliveryState): Promise<ContextResolution> {
  const cached = state.contexts.get(phoneNumberId);
  if (cached !== undefined) return cached;

  let resolution: ContextResolution;
  try {
    const result = await state.deps.loadContext(phoneNumberId);
    resolution = 'value' in result ? result.value ?? 'unknown' : 'infra_failure';
  } catch {
    resolution = 'infra_failure';
  }
  state.contexts.set(phoneNumberId, resolution);
  return resolution;
}

// Decide se o item pode ser gravado. Só consulta WABA em conexão com captura
// permitida: sem captura, nada é gravado, nem o motivo da recusa.
async function admit(item: { phoneNumberId: string; wabaId: string | null }, state: DeliveryState): Promise<Admission> {
  const context = await resolveContext(item.phoneNumberId, state);
  if (context === 'infra_failure') {
    state.summary.infraFailure = true;
    return { kind: 'stopped' };
  }
  if (context === 'unknown') {
    state.summary.unknownNumberCount += 1;
    return { kind: 'stopped' };
  }
  if (!context.captureAllowed) {
    state.summary.captureDisabledCount += 1;
    return { kind: 'stopped' };
  }
  if (item.wabaId === null || item.wabaId !== context.wabaId) {
    return { kind: 'waba_mismatch', context };
  }
  return { kind: 'admitted', context };
}

async function recordRefusal(
  message: RejectedInboundMessage,
  context: WhatsAppCaptureContext,
  errorCode: InboundEventFailureCode,
  state: DeliveryState,
): Promise<boolean> {
  const marked = await state.deps.markFailed({
    connectionId: context.connectionId,
    companyId: context.companyId,
    phoneNumberId: message.phoneNumberId,
    wabaId: context.wabaId,
    messageIdHash: hashWhatsAppMessageId(message.wamid),
    messageType: message.messageType,
    errorCode,
    occurredAt: message.occurredAt,
    receivedAt: state.receivedAt,
    requestId: state.requestId,
  });
  if (!marked.ok) state.summary.infraFailure = true;
  return marked.ok;
}

function buildCaptureInput(
  message: ParsedInboundMessage,
  context: WhatsAppCaptureContext,
  state: DeliveryState,
): CaptureInboundMessageInput {
  if (state.keys === null) state.keys = state.deps.loadKeys();
  const { content: contentKey, contactHmac: hmacKey } = state.keys;
  const { companyId, connectionId } = context;
  const { contact } = message;

  const messageIdHash = hashWhatsAppMessageId(message.wamid);
  const piiRef = randomUUID();

  return {
    connectionId,
    companyId,
    phoneNumberId: message.phoneNumberId,
    wabaId: context.wabaId,
    messageIdHash,
    messageType: message.messageType,
    occurredAt: message.occurredAt,
    receivedAt: state.receivedAt,
    requestId: state.requestId,
    bsuidHmac: contact.bsuid
      ? computeWhatsAppContactHmac({ kind: 'bsuid', companyId, value: contact.bsuid, key: hmacKey })
      : null,
    phoneHmac: contact.phone
      ? computeWhatsAppContactHmac({ kind: 'phone', companyId, value: contact.phone, key: hmacKey })
      : null,
    piiCiphertext: encryptWhatsAppContactPii({ companyId, piiRef, contact, key: contentKey }),
    piiRef,
    piiHasPhone: contact.phone !== null,
    contentCiphertext: encryptWhatsAppMessageContent({
      companyId,
      connectionId,
      messageIdHash,
      key: contentKey,
      payload: { wamid: message.wamid, content: message.content, repliedToWamid: message.repliedToWamid },
    }),
    keyVersion: WHATSAPP_CAPTURE_KEY_VERSION,
  };
}

async function captureMessage(message: ParsedInboundMessage, state: DeliveryState): Promise<void> {
  const { summary } = state;
  const admission = await admit(message, state);
  if (admission.kind === 'stopped') return;

  if (admission.kind === 'waba_mismatch') {
    const refused: RejectedInboundMessage = {
      wabaId: message.wabaId,
      phoneNumberId: message.phoneNumberId,
      wamid: message.wamid,
      messageType: message.messageType,
      occurredAt: message.occurredAt,
    };
    if (await recordRefusal(refused, admission.context, 'waba_mismatch', state)) summary.wabaMismatchCount += 1;
    return;
  }

  let input: CaptureInboundMessageInput;
  try {
    input = buildCaptureInput(message, admission.context, state);
  } catch {
    // Sem chave válida ou falha de cifragem: nada foi persistido, a Meta reentrega.
    summary.infraFailure = true;
    return;
  }

  const result = await state.deps.capture(input);
  if ('outcome' in result === false) {
    summary.infraFailure = true;
    return;
  }

  switch (result.outcome) {
    case 'captured':
      summary.capturedCount += 1;
      return;
    case 'duplicate':
      summary.duplicateCount += 1;
      return;
    case 'capture_disabled':
      summary.captureDisabledCount += 1;
      return;
    case 'waba_mismatch':
      summary.wabaMismatchCount += 1;
      return;
    case 'connection_not_connected':
      summary.unknownNumberCount += 1;
      return;
    default:
      summary.unusableCount += 1;
  }
}

async function refuseMessage(
  message: RejectedInboundMessage,
  errorCode: 'contact_unresolved' | 'group_message',
  state: DeliveryState,
): Promise<void> {
  const { summary } = state;
  const admission = await admit(message, state);
  if (admission.kind === 'stopped') return;

  if (admission.kind === 'waba_mismatch') {
    if (await recordRefusal(message, admission.context, 'waba_mismatch', state)) summary.wabaMismatchCount += 1;
    return;
  }
  if (!(await recordRefusal(message, admission.context, errorCode, state))) return;
  if (errorCode === 'group_message') summary.groupMessageCount += 1;
  else summary.failedCount += 1;
}

export async function ingestWhatsAppDelivery(
  payload: unknown,
  requestId: string,
  deps: WhatsAppIngestionDeps = defaultDeps(),
): Promise<WhatsAppIngestionSummary> {
  const receivedAt = deps.now();
  const delivery = parseWhatsAppInboundDelivery(payload, { now: receivedAt });
  const state: DeliveryState = {
    summary: emptyWhatsAppIngestionSummary(),
    contexts: new Map(),
    keys: null,
    receivedAt,
    requestId,
    deps,
  };
  const { summary } = state;
  summary.duplicateCount += delivery.duplicateCount;
  summary.invalidTimestampCount = delivery.invalidTimestampCount;

  try {
    for (const message of delivery.messages) {
      await captureMessage(message, state);
    }

    for (const rejected of delivery.rejected) {
      if (rejected.message === null) {
        if (rejected.reason === 'group_message') summary.groupMessageCount += 1;
        else summary.unusableCount += 1;
      } else if (rejected.reason === 'group_message' || rejected.reason === 'missing_contact') {
        await refuseMessage(
          rejected.message,
          rejected.reason === 'group_message' ? 'group_message' : 'contact_unresolved',
          state,
        );
      } else {
        summary.unusableCount += 1;
      }
    }

    for (const status of delivery.statuses) {
      const admission = await admit(status, state);
      if (admission.kind === 'stopped') continue;
      if (admission.kind === 'waba_mismatch') {
        summary.wabaMismatchCount += 1;
        continue;
      }

      const registered = await deps.register({
        connectionId: admission.context.connectionId,
        companyId: admission.context.companyId,
        phoneNumberId: status.phoneNumberId,
        eventKind: 'status',
        messageIdHash: hashWhatsAppMessageId(status.wamid),
        messageType: null,
        statusValue: status.statusValue,
        statusKeyHash: hashWhatsAppStatusKey(status.rawStatus),
        occurredAt: status.occurredAt,
        receivedAt: state.receivedAt,
      });
      if ('value' in registered === false) {
        summary.infraFailure = true;
      } else if (registered.value.created) {
        summary.registeredCount += 1;
      } else {
        summary.duplicateCount += 1;
      }
    }
  } finally {
    if (state.keys !== null) clearWhatsAppCaptureKeys(state.keys);
  }

  return summary;
}
