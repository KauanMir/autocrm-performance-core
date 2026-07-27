// tests/server/users/errors.test.ts — catálogo de códigos de erro HTTP do
// fluxo administrativo de alteração de e-mail (M1-F S5-E1-A, design §22.7).
import { describe, expect, it } from 'vitest';
import { statusForCode, type UserEmailErrorCode } from '@/lib/server/users/errors';

describe('statusForCode', () => {
  const cases: Array<[UserEmailErrorCode, number]> = [
    ['invalid_body', 400],
    ['invalid_email', 400],
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['invalid_origin', 403],
    ['user_not_found', 404],
    ['user_inactive', 409],
    ['email_already_in_use', 409],
    ['user_email_state_conflict', 409],
    ['email_update_failed', 500],
    ['email_compensation_failed', 503],
    ['internal_error', 500],
    ['body_too_large', 413],
  ];

  it.each(cases)('%s → %i', (code, expectedStatus) => {
    expect(statusForCode(code)).toBe(expectedStatus);
  });
});
