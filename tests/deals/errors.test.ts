// Testes de lib/deals/errors.ts (COMMERCIAL-REMOTE-DEALS-B2-A). Puro.
import { describe, expect, it } from 'vitest';
import { RemoteDealsError, isRemoteDealsError } from '@/lib/deals/errors';

describe('RemoteDealsError', () => {
  it('message é o código estável (nada interno vaza)', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed');
    expect(error.message).toBe('remote_deals_fetch_failed');
    expect(error.code).toBe('remote_deals_fetch_failed');
    expect(error.name).toBe('RemoteDealsError');
  });

  it('detail default é objeto vazio quando omitido', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed');
    expect(error.detail).toEqual({});
  });

  it('detail preserva somente o que foi passado explicitamente', () => {
    const error = new RemoteDealsError('remote_deals_fetch_failed', { code: '42501', message: 'permission denied' });
    expect(error.detail).toEqual({ code: '42501', message: 'permission denied' });
  });

  it('isRemoteDealsError reconhece a instância e rejeita outros erros', () => {
    expect(isRemoteDealsError(new RemoteDealsError('remote_deals_fetch_failed'))).toBe(true);
    expect(isRemoteDealsError(new Error('outro erro'))).toBe(false);
    expect(isRemoteDealsError('remote_deals_fetch_failed')).toBe(false);
    expect(isRemoteDealsError(null)).toBe(false);
    expect(isRemoteDealsError(undefined)).toBe(false);
  });

  it('é uma instância real de Error (compatível com try/catch/throw)', () => {
    const error = new RemoteDealsError('remote_deals_invalid_context');
    expect(error).toBeInstanceOf(Error);
  });
});
