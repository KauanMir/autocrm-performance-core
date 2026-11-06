// WHATSAPP-W2B-8 — flags da inbox. Default OFF, sem override e sem demonstração
// fora de desenvolvimento.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWhatsAppInboxDemoEnabled, isWhatsAppInboxEnabled } from '@/lib/flags';

afterEach(() => {
  vi.unstubAllEnvs();
  try { window.localStorage.clear(); } catch { /* ambiente sem storage */ }
});

describe('isWhatsAppInboxEnabled', () => {
  it.each([[undefined], [''], ['false'], ['1'], ['TRUE'], [' true']])('%j -> false', (value) => {
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX', value as unknown as string);
    expect(isWhatsAppInboxEnabled()).toBe(false);
  });

  it("'true' -> true", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX', 'true');
    expect(isWhatsAppInboxEnabled()).toBe(true);
  });

  it('localStorage não liga a flag', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX', 'false');
    window.localStorage.setItem('autocrm_ff_whatsapp_inbox', 'true');
    expect(isWhatsAppInboxEnabled()).toBe(false);
  });
});

describe('isWhatsAppInboxDemoEnabled', () => {
  it('development + flag true -> true', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', 'true');
    expect(isWhatsAppInboxDemoEnabled()).toBe(true);
  });

  it.each(['production', 'test'])('%s -> false, mesmo com a flag ligada', (env) => {
    vi.stubEnv('NODE_ENV', env);
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', 'true');
    expect(isWhatsAppInboxDemoEnabled()).toBe(false);
  });

  it('development sem a flag -> false', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_FF_WHATSAPP_INBOX_DEMO', undefined as unknown as string);
    expect(isWhatsAppInboxDemoEnabled()).toBe(false);
  });
});
