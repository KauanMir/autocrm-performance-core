// lib/server/whatsapp-webhook/event-hashes.ts — impressões digitais usadas
// pelo ledger de eventos (W2A). Tudo em memória; só o hash sai daqui.
//
// wamid: a Cloud API codifica o telefone do contato em base64 dentro dele,
// então o wamid NUNCA é persistido nem logado cru — o ledger guarda só o
// SHA-256 (com domínio fixo). A W2B usa a mesma função no wamid devolvido
// pelo envio para correlacionar statuses com a mensagem enviada.
//
// status bruto: entra SOMENTE como material do event_key. O ledger guarda a
// classificação da allowlist (ou 'other'); este hash separa dois statuses
// desconhecidos distintos do mesmo wamid, que senão colidiriam em 'other'.
import { createHash } from 'node:crypto';

const MESSAGE_ID_DOMAIN = 'whatsapp-message-id:v1:';
const STATUS_KEY_DOMAIN = 'whatsapp-status-key:v1:';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashWhatsAppMessageId(messageId: string): string {
  return sha256Hex(MESSAGE_ID_DOMAIN + messageId);
}

// `rawStatus` é o valor de statuses[].status como veio no JSON. String e
// não-string recebem prefixos distintos ("s:" / "j:") para que, por exemplo,
// a string "null" e um status ausente não colidam.
export function hashWhatsAppStatusKey(rawStatus: unknown): string {
  const material =
    typeof rawStatus === 'string' ? `s:${rawStatus}` : `j:${JSON.stringify(rawStatus === undefined ? null : rawStatus)}`;
  return sha256Hex(STATUS_KEY_DOMAIN + material);
}
