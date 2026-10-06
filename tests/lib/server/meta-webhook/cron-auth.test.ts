// Comparação timing-safe do Bearer de cron. Valores fictícios.
import { describe, expect, it } from 'vitest';
import { isAuthorizedCronRequest } from '@/lib/server/meta-webhook/cron-auth';

const SECRET = 'fake-cron-secret-0123456789-not-real';

describe('isAuthorizedCronRequest', () => {
  it('aceita exatamente "Bearer <secret>"', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('recusa header nulo', () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it('recusa secret ausente, vazio ou undefined (falha fechada)', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, '')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false);
  });

  it('recusa prefixo diferente, secret sem prefixo e secret com sufixo extra', () => {
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it('comprimento diferente não lança exceção e recusa', () => {
    expect(() => isAuthorizedCronRequest('Bearer x', SECRET)).not.toThrow();
    expect(isAuthorizedCronRequest('Bearer x', SECRET)).toBe(false);
  });
});
