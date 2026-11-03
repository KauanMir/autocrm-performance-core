// lib/server/whatsapp-webhook/ingestion.ts — W2A: registra no ledger
// durável (whatsapp_webhook_events) os eventos JÁ classificados de UMA
// entrega. SERVER-ONLY. Só roda com WHATSAPP_INGESTION_ENABLED=true.
//   - resolve phone_number_id → company (só conexões connected);
//   - registra cada evento de forma idempotente (reentrega não duplica);
//   - NÃO cria conversa/mensagem CRM, NÃO chama Graph, NÃO decifra token;
//   - persiste só o hash do wamid, nunca o wamid cru.
// Quem chama decide o HTTP: infraFailure => 503 (Meta reentrega; o registro
// é idempotente); demais => 200.
import { createWhatsAppConnectionRpcPort, type WhatsAppOwnerRow } from '@/lib/server/whatsapp-connection/connection-rpc';
import { registerWhatsAppEvent } from './events-rpc';
import type { WhatsAppWebhookEvent } from './events';
import { hashWhatsAppMessageId, hashWhatsAppStatusKey } from './event-hashes';

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_MESSAGE_ID_LENGTH = 512;

export interface WhatsAppIngestionSummary {
  registeredCount: number;
  duplicateCount: number;
  unknownNumberCount: number;
  unusableCount: number;
  infraFailure: boolean;
}

export interface WhatsAppIngestionDeps {
  ownerByPhoneNumber: (
    phoneNumberId: string,
  ) => Promise<{ data: WhatsAppOwnerRow[] | null; error: { code?: string } | null }>;
  register: typeof registerWhatsAppEvent;
  now: () => Date;
}

const defaultDeps = (): WhatsAppIngestionDeps => ({
  ownerByPhoneNumber: (phoneNumberId) => createWhatsAppConnectionRpcPort().ownerByPhoneNumber(phoneNumberId),
  register: registerWhatsAppEvent,
  now: () => new Date(),
});

type OwnerResolution = WhatsAppOwnerRow | 'unknown' | 'infra_failure';

export async function ingestWhatsAppEvents(
  events: WhatsAppWebhookEvent[],
  deps: WhatsAppIngestionDeps = defaultDeps(),
): Promise<WhatsAppIngestionSummary> {
  const summary: WhatsAppIngestionSummary = {
    registeredCount: 0,
    duplicateCount: 0,
    unknownNumberCount: 0,
    unusableCount: 0,
    infraFailure: false,
  };
  // Um lookup por phone_number_id distinto por entrega.
  const owners = new Map<string, OwnerResolution>();
  const receivedAt = deps.now();

  for (const event of events) {
    const phoneNumberId = event.phoneNumberId;
    const messageId = event.messageId;
    if (
      !phoneNumberId ||
      !PHONE_NUMBER_ID_PATTERN.test(phoneNumberId) ||
      !messageId ||
      messageId.length > MAX_MESSAGE_ID_LENGTH
    ) {
      summary.unusableCount += 1;
      continue;
    }

    let owner = owners.get(phoneNumberId);
    if (owner === undefined) {
      owner = await resolveOwner(phoneNumberId, deps);
      owners.set(phoneNumberId, owner);
    }
    if (owner === 'infra_failure') {
      summary.infraFailure = true;
      continue;
    }
    if (owner === 'unknown') {
      summary.unknownNumberCount += 1;
      continue;
    }

    const isMessage = event.eventType === 'message_received';
    const registered = await deps.register({
      connectionId: owner.connection_id,
      companyId: owner.company_id,
      phoneNumberId,
      eventKind: isMessage ? 'message' : 'status',
      messageIdHash: hashWhatsAppMessageId(messageId),
      messageType: isMessage ? event.messageType ?? 'other' : null,
      statusValue: isMessage ? null : event.status ?? 'other',
      statusKeyHash: isMessage ? null : hashWhatsAppStatusKey(event.rawStatus),
      occurredAt: event.occurredAt ?? null,
      receivedAt,
    });
    if (!registered.ok) {
      summary.infraFailure = true;
      continue;
    }
    if (registered.value.created) summary.registeredCount += 1;
    else summary.duplicateCount += 1;
  }

  return summary;
}

async function resolveOwner(phoneNumberId: string, deps: WhatsAppIngestionDeps): Promise<OwnerResolution> {
  try {
    const { data, error } = await deps.ownerByPhoneNumber(phoneNumberId);
    if (error) return 'infra_failure';
    const row = data?.[0];
    return row && row.status === 'connected' ? row : 'unknown';
  } catch {
    return 'infra_failure';
  }
}
