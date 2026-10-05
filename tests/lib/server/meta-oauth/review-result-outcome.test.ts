// META-P4B — review token com outcome/persisted/failureCode. Segredos fake.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createReviewResultToken,
  REVIEW_RESULT_FAILURE_CODES,
  verifyReviewResultToken,
} from '@/lib/server/meta-oauth/review-result';

const SECRET = Buffer.from('c'.repeat(64), 'hex');
const COMPANY = '0a0a0a0a-0000-4000-8000-00000000c0de';

function signedRaw(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64url');
  return `${body}.${sig}`;
}

function basePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    p: 'meta_oauth_review_result',
    n: 'fake-nonce-000000000000',
    iat: now,
    exp: now + 60,
    cid: COMPANY,
    stage: 'test_page_permissions_verified',
    outcome: 'success',
    persisted: true,
    failureCode: null,
    ...over,
  };
}

const verifyOpts = { secret: SECRET, expectedCompanyId: COMPANY };

describe('createReviewResultToken — outcome e persisted', () => {
  it('sucesso por padrão, sem persistência (compatível com o fluxo atual)', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY });
    const result = verifyReviewResultToken(token, verifyOpts);
    expect(result.ok && result.payload.outcome).toBe('success');
    expect(result.ok && result.payload.persisted).toBe(false);
    expect(result.ok && result.payload.failureCode).toBeNull();
  });

  it('sucesso com persistência: persisted=true', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY, outcome: 'success', persisted: true });
    const result = verifyReviewResultToken(token, verifyOpts);
    expect(result.ok && result.payload.persisted).toBe(true);
  });

  it('falha: outcome failure, persisted sempre false, código fechado', () => {
    const token = createReviewResultToken({
      secret: SECRET,
      companyId: COMPANY,
      outcome: 'failure',
      persisted: true,
      failureCode: 'page_already_connected',
    });
    const result = verifyReviewResultToken(token, verifyOpts);
    expect(result.ok && result.payload.outcome).toBe('failure');
    expect(result.ok && result.payload.persisted).toBe(false);
    expect(result.ok && result.payload.failureCode).toBe('page_already_connected');
  });

  it.each(REVIEW_RESULT_FAILURE_CODES)('código de falha %s é aceito', (code) => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY, outcome: 'failure', failureCode: code });
    expect(verifyReviewResultToken(token, verifyOpts).ok).toBe(true);
  });

  it('token de falha não carrega nada além de metadados fechados', () => {
    const token = createReviewResultToken({ secret: SECRET, companyId: COMPANY, outcome: 'failure', failureCode: 'connection_persist_failed' });
    const decoded = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(
      ['cid', 'exp', 'failureCode', 'iat', 'n', 'outcome', 'p', 'persisted', 'stage', 'v'].sort(),
    );
    expect(decoded).not.toMatch(/v1\.|access_token|DETAIL|SQL/);
  });
});

describe('verifyReviewResultToken — combinações inválidas são rejeitadas', () => {
  it('sucesso com failureCode é malformado', () => {
    expect(verifyReviewResultToken(signedRaw(basePayload({ failureCode: 'page_already_connected' })), verifyOpts)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('falha com persisted=true é malformada', () => {
    expect(
      verifyReviewResultToken(signedRaw(basePayload({ outcome: 'failure', persisted: true, failureCode: 'persistence_unavailable' })), verifyOpts),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('código de falha desconhecido é malformado', () => {
    expect(
      verifyReviewResultToken(signedRaw(basePayload({ outcome: 'failure', persisted: false, failureCode: 'SQL_DETAIL_LEAK' })), verifyOpts),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('outcome desconhecido é malformado', () => {
    expect(verifyReviewResultToken(signedRaw(basePayload({ outcome: 'partial' })), verifyOpts)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('token sem os campos novos (formato antigo) é malformado', () => {
    const legacy = basePayload();
    delete legacy.outcome;
    delete legacy.persisted;
    delete legacy.failureCode;
    expect(verifyReviewResultToken(signedRaw(legacy), verifyOpts)).toEqual({ ok: false, reason: 'malformed' });
  });
});
