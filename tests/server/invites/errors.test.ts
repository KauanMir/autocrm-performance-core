// tests/server/invites/errors.test.ts — catálogo de códigos de erro HTTP
// do módulo de convites (M1-F S4-A2B, design §16).
import { describe, expect, it } from 'vitest';
import { statusForCode, isKnownDomainCode, type InviteErrorCode } from '@/lib/server/invites/errors';

describe('statusForCode', () => {
  const cases: Array<[InviteErrorCode, number]> = [
    ['invalid_body', 400],
    ['invalid_input', 400],
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['invalid_origin', 403],
    ['duplicate_pending', 409],
    ['already_member', 409],
    ['not_eligible', 409],
    ['token_conflict', 409],
    ['invalid_role', 422],
    ['invalid_company', 422],
    ['company_not_operational', 422],
    ['rate_limited', 429],
    ['delivery_failed', 502],
    ['auth_unavailable', 503],
    ['internal_error', 500],
    ['delivery_finalize_failed', 503],
    ['invite_not_found', 404],
    ['invite_not_actionable', 409],
    ['body_too_large', 413],
  ];

  it.each(cases)('%s → %i', (code, expectedStatus) => {
    expect(statusForCode(code)).toBe(expectedStatus);
  });
});

describe('isKnownDomainCode', () => {
  it('reconhece todos os códigos de domínio devolvidos por create_invite/resend_invite', () => {
    const domainCodes = [
      'invalid_input',
      'invalid_role',
      'invalid_company',
      'company_not_operational',
      'already_member',
      'not_eligible',
      'duplicate_pending',
      'token_conflict',
      'invite_not_found',
      'invite_not_actionable',
    ];

    for (const code of domainCodes) {
      expect(isKnownDomainCode(code)).toBe(true);
    }
  });

  it('rejeita códigos puramente HTTP (nunca devolvidos por uma RPC)', () => {
    expect(isKnownDomainCode('unauthenticated')).toBe(false);
    expect(isKnownDomainCode('invalid_origin')).toBe(false);
    expect(isKnownDomainCode('rate_limited')).toBe(false);
    expect(isKnownDomainCode('body_too_large')).toBe(false);
  });

  it('rejeita um código desconhecido (ex.: invalid_token_hash, defesa contra bug de schema futuro)', () => {
    expect(isKnownDomainCode('invalid_token_hash')).toBe(false);
    expect(isKnownDomainCode('something_never_seen_before')).toBe(false);
  });
});
