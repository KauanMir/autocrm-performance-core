// Verificação do Bearer de cron (CRON_SECRET). SERVER-ONLY. Falha fechada: secret
// ausente ou vazio nunca autoriza. A comparação usa digests SHA-256 de tamanho
// fixo com timingSafeEqual, então nem o conteúdo nem o comprimento do secret
// vazam por timing. Nunca lança exceção com o valor do secret ou do header.
import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (authorization === null || !secret) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
