// META-OAUTH-REVIEW-UI — leitura da flag dedicada NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW.
// Default OFF: ausente, inválida ou 'false' = OFF. Só a string exata 'true' liga.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isMetaIntegrationsReviewEnabled', () => {
  it('ausente -> false', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', undefined as unknown as string);
    expect(isMetaIntegrationsReviewEnabled()).toBe(false);
  });

  it('vazia -> false', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', '');
    expect(isMetaIntegrationsReviewEnabled()).toBe(false);
  });

  it("'false' -> false", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    expect(isMetaIntegrationsReviewEnabled()).toBe(false);
  });

  it.each(['1', 'yes', 'on', 'TRUE', ' true', 'True'])('valor inválido %j -> false (fail closed)', (value) => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', value);
    expect(isMetaIntegrationsReviewEnabled()).toBe(false);
  });

  it("'true' exato -> true", () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
    expect(isMetaIntegrationsReviewEnabled()).toBe(true);
  });

  it('não depende de NEXT_PUBLIC_FF_PLATFORM_ADMIN (flag de outra funcionalidade)', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_PLATFORM_ADMIN', 'true');
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    expect(isMetaIntegrationsReviewEnabled()).toBe(false);
  });
});
