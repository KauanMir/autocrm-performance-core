// META-P4A — parser estrito da flag server-only META_CONNECTION_PERSISTENCE_ENABLED.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMetaConnectionPersistenceEnabled } from '@/lib/server/meta-oauth/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isMetaConnectionPersistenceEnabled — default OFF, parse estrito', () => {
  it('ausente -> false', () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', undefined as unknown as string);
    expect(isMetaConnectionPersistenceEnabled()).toBe(false);
  });

  it.each(['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', 'truee'])('valor %j -> false', (value) => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', value);
    expect(isMetaConnectionPersistenceEnabled()).toBe(false);
  });

  it('somente a string exata "true" -> true', () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    expect(isMetaConnectionPersistenceEnabled()).toBe(true);
  });

  it('não depende de NEXT_PUBLIC_ (variável pública não liga a persistência)', () => {
    vi.stubEnv('NEXT_PUBLIC_META_CONNECTION_PERSISTENCE_ENABLED', 'true');
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    expect(isMetaConnectionPersistenceEnabled()).toBe(false);
  });
});
