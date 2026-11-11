// lib/server/kapa-leads-sync/signature.ts — assinatura das chamadas ao KAPA Leads. SERVER-ONLY.
// Mesmo contrato v1 de kapa-leads-platform/src/lib/crm-export/signature.ts:
//   X-Kapa-Timestamp: segundos Unix
//   X-Kapa-Signature: v1=<hex HMAC-SHA256 de "v1:<timestamp>:<MÉTODO>:<pathname><search>">
import { createHmac } from 'node:crypto';

export function signatureMessage(timestamp: string, method: string, pathAndQuery: string): string {
  return `v1:${timestamp}:${method.toUpperCase()}:${pathAndQuery}`;
}

export function signedHeaders(secret: string, method: string, pathAndQuery: string, nowMs: number): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  const digest = createHmac('sha256', secret).update(signatureMessage(timestamp, method, pathAndQuery), 'utf8').digest('hex');
  return { 'X-Kapa-Timestamp': timestamp, 'X-Kapa-Signature': `v1=${digest}` };
}
