// tests/lib/server/meta-oauth/review-result.test.ts — módulo PURO
// (META-OAUTH-REVIEW-UI): token efêmero e assinado que prova, por um TTL
// curto, que o callback chegou a test_page_permissions_verified para a
// company de teste. Sem I/O, sem rede, sem banco.
import { describe, expect, it } from 'vitest';
import {
  createReviewResultToken,
  verifyReviewResultToken,
  REVIEW_RESULT_TTL_SECONDS,
  REVIEW_RESULT_STAGE_VERIFIED,
} from '@/lib/server/meta-oauth/review-result';

const SECRET = Buffer.from('a'.repeat(64), 'hex');
const OTHER_SECRET = Buffer.from('b'.repeat(64), 'hex');
const COMPANY_ID = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const OTHER_COMPANY_ID = '11111111-1111-4111-8111-111111111111';

describe('createReviewResultToken / verifyReviewResultToken', () => {
  it('roundtrip válido: assina e verifica com o mesmo segredo e a mesma company', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    const verified = verifyReviewResultToken(token, { secret: SECRET, expectedCompanyId: COMPANY_ID });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.cid).toBe(COMPANY_ID);
      expect(verified.payload.stage).toBe(REVIEW_RESULT_STAGE_VERIFIED);
      expect(verified.payload.stage).toBe('test_page_permissions_verified');
    }
  });

  it('nunca carrega o segredo no token', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    expect(token).not.toContain('a'.repeat(64));
  });

  it('assinado com OUTRO segredo -> bad_signature', () => {
    const token = createReviewResultToken({ secret: OTHER_SECRET, companyId: COMPANY_ID });
    const verified = verifyReviewResultToken(token, { secret: SECRET, expectedCompanyId: COMPANY_ID });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect('reason' in verified ? verified.reason : undefined).toBe('bad_signature');
  });

  it('corpo adulterado (payload trocado, assinatura original mantida) -> bad_signature', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    const [, sig] = token.split('.');
    const tamperedBody = Buffer.from(
      JSON.stringify({ v: 1, p: 'meta_oauth_review_result', n: 'x', iat: 1, exp: 999999999999, cid: COMPANY_ID, stage: REVIEW_RESULT_STAGE_VERIFIED }),
      'utf8',
    ).toString('base64url');
    const verified = verifyReviewResultToken(`${tamperedBody}.${sig}`, { secret: SECRET, expectedCompanyId: COMPANY_ID });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect('reason' in verified ? verified.reason : undefined).toBe('bad_signature');
  });

  it('company diferente da esperada -> context_mismatch, mesmo com assinatura válida', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    const verified = verifyReviewResultToken(token, { secret: SECRET, expectedCompanyId: OTHER_COMPANY_ID });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect('reason' in verified ? verified.reason : undefined).toBe('context_mismatch');
  });

  it('expirado (TTL vencido) -> expired', () => {
    const nowMs = Date.now();
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID, nowMs: nowMs - (REVIEW_RESULT_TTL_SECONDS + 5) * 1000 });
    const verified = verifyReviewResultToken(token, { secret: SECRET, expectedCompanyId: COMPANY_ID, nowMs });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect('reason' in verified ? verified.reason : undefined).toBe('expired');
  });

  it('TTL é curto (poucos minutos) — nunca um mecanismo de persistência', () => {
    expect(REVIEW_RESULT_TTL_SECONDS).toBeLessThanOrEqual(600);
    expect(REVIEW_RESULT_TTL_SECONDS).toBeGreaterThan(0);
  });

  it('string malformada / vazia / lixo -> malformed', () => {
    for (const bad of ['', 'not-a-token', 'a.b.c', 'a'.repeat(5000)]) {
      const verified = verifyReviewResultToken(bad, { secret: SECRET, expectedCompanyId: COMPANY_ID });
      expect(verified.ok).toBe(false);
    }
  });

  it('não-string (número, objeto, null, undefined) -> malformed, nunca lança', () => {
    for (const bad of [123, {}, null, undefined, ['x']]) {
      const verified = verifyReviewResultToken(bad, { secret: SECRET, expectedCompanyId: COMPANY_ID });
      expect(verified.ok).toBe(false);
    }
  });

  it('cada token tem um nonce diferente (imprevisível)', () => {
    const t1 = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    const t2 = createReviewResultToken({ secret: SECRET, companyId: COMPANY_ID });
    expect(t1).not.toBe(t2);
  });
});
