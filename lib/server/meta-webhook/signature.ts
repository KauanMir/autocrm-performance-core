// lib/server/meta-webhook/signature.ts — validação do header
// X-Hub-Signature-256 dos webhooks da Meta. HMAC SHA-256 sobre o RAW BODY
// exato recebido, chave = META_APP_SECRET, comparação em tempo constante.
// Nenhuma função aqui loga nem devolve material de assinatura.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
// HMAC-SHA256 em hex minúsculo tem exatamente 64 caracteres.
const HEX_64 = /^[0-9a-f]{64}$/;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'mismatch' };

// `header`   valor bruto de X-Hub-Signature-256 (ex.: "sha256=<hex>").
// `rawBody`  exatamente o texto lido de request.text() ANTES de qualquer
//            parse de JSON — a assinatura é calculada sobre esses bytes.
// `appSecret` vem de getMetaAppSecret().
export function verifyMetaSignature(
  header: string | null,
  rawBody: string,
  appSecret: string,
): SignatureCheck {
  if (header === null || header.trim() === '') {
    return { ok: false, reason: 'missing' };
  }

  if (!header.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: 'malformed' };
  }

  const received = header.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (!HEX_64.test(received)) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // Ambos são 32 bytes (HEX_64 garante os 64 hex) — timingSafeEqual exige
  // Buffers de mesmo comprimento.
  const receivedBuf = Buffer.from(received, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}
