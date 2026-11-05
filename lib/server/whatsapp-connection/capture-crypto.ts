// lib/server/whatsapp-connection/capture-crypto.ts — W2B-5: proteção dos dados
// capturados do WhatsApp. SERVER-ONLY. Usa a primitiva aead-envelope, com chave e
// domínios de AAD próprios, e nunca decifra nada no banco.
//
// AAD amarra cada envelope ao lugar dele. Mover o ciphertext para outra empresa,
// conexão, mensagem ou contato invalida a decifragem:
//   whatsapp-message-content:v<N>:<company_id>:<connection_id>:<message_id_hash>
//   whatsapp-contact-pii:v<N>:<company_id>:<pii_ref>
//
// A busca de contato usa HMAC-SHA-256 com segredo e vinculado à empresa. SHA-256
// puro de telefone seria reversível por força bruta, e a mesma pessoa em duas
// empresas não pode gerar o mesmo valor.
import { createHmac } from 'node:crypto';
import { openAeadEnvelope, sealAeadEnvelope } from '@/lib/server/crypto/aead-envelope';
import type { InboundContact, InboundContent } from '@/lib/server/whatsapp-webhook/inbound-parser';
import { getWhatsAppContactHmacKeyV1, getWhatsAppContentEncryptionKeyV1 } from './env';

export const WHATSAPP_CAPTURE_KEY_VERSION = 1 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class WhatsAppCaptureContextError extends Error {
  constructor() {
    super('whatsapp_capture_context_invalid');
    this.name = 'WhatsAppCaptureContextError';
  }
}

export interface WhatsAppCaptureKeys {
  content: Buffer;
  contactHmac: Buffer;
}

export function loadWhatsAppCaptureKeys(): WhatsAppCaptureKeys {
  const content = getWhatsAppContentEncryptionKeyV1();
  try {
    return { content, contactHmac: getWhatsAppContactHmacKeyV1() };
  } catch (error) {
    content.fill(0);
    throw error;
  }
}

export function clearWhatsAppCaptureKeys(keys: WhatsAppCaptureKeys): void {
  keys.content.fill(0);
  keys.contactHmac.fill(0);
}

function uuid(value: string): string {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID_PATTERN.test(normalized)) throw new WhatsAppCaptureContextError();
  return normalized;
}

function hash(value: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new WhatsAppCaptureContextError();
  return value;
}

export function computeWhatsAppContactHmac(input: {
  kind: 'bsuid' | 'phone';
  companyId: string;
  value: string;
  key: Buffer;
}): string {
  if (typeof input.value !== 'string' || input.value === '') throw new WhatsAppCaptureContextError();
  return createHmac('sha256', input.key)
    .update(`whatsapp-contact:v${WHATSAPP_CAPTURE_KEY_VERSION}:${input.kind}:${uuid(input.companyId)}:${input.value}`, 'utf8')
    .digest('hex');
}

export interface WhatsAppMessageEnvelopeContext {
  companyId: string;
  connectionId: string;
  messageIdHash: string;
}

// Conteúdo mínimo: o wamid só existe aqui dentro, nunca em coluna.
export interface WhatsAppMessageEnvelopePayload {
  wamid: string;
  content: InboundContent;
  repliedToWamid: string | null;
}

function messageAad(context: WhatsAppMessageEnvelopeContext): string {
  return [
    `whatsapp-message-content:v${WHATSAPP_CAPTURE_KEY_VERSION}`,
    uuid(context.companyId),
    uuid(context.connectionId),
    hash(context.messageIdHash),
  ].join(':');
}

export function encryptWhatsAppMessageContent(
  input: WhatsAppMessageEnvelopeContext & { payload: WhatsAppMessageEnvelopePayload; key: Buffer },
): string {
  return sealAeadEnvelope({
    plaintext: JSON.stringify(input.payload),
    key: input.key,
    aad: messageAad(input),
    version: `v${WHATSAPP_CAPTURE_KEY_VERSION}`,
  });
}

export function decryptWhatsAppMessageContent(
  input: WhatsAppMessageEnvelopeContext & { ciphertext: string; key: Buffer },
): WhatsAppMessageEnvelopePayload {
  return JSON.parse(
    openAeadEnvelope({
      envelope: input.ciphertext,
      key: input.key,
      aad: messageAad(input),
      version: `v${WHATSAPP_CAPTURE_KEY_VERSION}`,
    }),
  ) as WhatsAppMessageEnvelopePayload;
}

export interface WhatsAppContactEnvelopeContext {
  companyId: string;
  piiRef: string;
}

function contactAad(context: WhatsAppContactEnvelopeContext): string {
  return [`whatsapp-contact-pii:v${WHATSAPP_CAPTURE_KEY_VERSION}`, uuid(context.companyId), uuid(context.piiRef)].join(':');
}

export function encryptWhatsAppContactPii(
  input: WhatsAppContactEnvelopeContext & { contact: InboundContact; key: Buffer },
): string {
  return sealAeadEnvelope({
    plaintext: JSON.stringify(input.contact),
    key: input.key,
    aad: contactAad(input),
    version: `v${WHATSAPP_CAPTURE_KEY_VERSION}`,
  });
}

export function decryptWhatsAppContactPii(
  input: WhatsAppContactEnvelopeContext & { ciphertext: string; key: Buffer },
): InboundContact {
  return JSON.parse(
    openAeadEnvelope({
      envelope: input.ciphertext,
      key: input.key,
      aad: contactAad(input),
      version: `v${WHATSAPP_CAPTURE_KEY_VERSION}`,
    }),
  ) as InboundContact;
}
