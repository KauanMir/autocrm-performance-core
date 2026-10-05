// tests/lib/server/meta-oauth/state-flow.test.ts — cobertura FOCADA no
// campo `f` (flow) do state assinado, adicionado para META-OAUTH-REVIEW-UI.
// A cobertura geral de state.ts (assinatura/TTL/binding/uid/cid) já existe,
// indiretamente, em tests/api/integrations/meta/oauth-start.test.ts e
// oauth-callback*.test.ts — este arquivo só testa o que é NOVO: `f` é um
// catálogo fechado de UM literal, nunca uma string livre.
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createOAuthState, verifyOAuthState, OAUTH_STATE_FLOW_REVIEW_UI } from '@/lib/server/meta-oauth/state';

const SECRET = Buffer.from('a'.repeat(64), 'hex');
const BINDING = 'test-binding-value-not-a-secret-000000000000';

describe('state.ts — campo `f` (flow), catálogo fechado', () => {
  it('createOAuthState sem `flow` -> state nunca carrega `f`', () => {
    const state = createOAuthState({ secret: SECRET, binding: BINDING });
    const verified = verifyOAuthState(state, { secret: SECRET, expectedBinding: BINDING });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.f).toBeUndefined();
  });

  it('createOAuthState com flow="review_ui" -> state carrega f="review_ui", assinado', () => {
    const state = createOAuthState({ secret: SECRET, binding: BINDING, flow: OAUTH_STATE_FLOW_REVIEW_UI });
    const verified = verifyOAuthState(state, { secret: SECRET, expectedBinding: BINDING });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.f).toBe('review_ui');
  });

  it('um `f` forjado com valor fora do catálogo fechado (mesmo com assinatura válida) -> malformed', () => {
    // Simula um state assinado por um chamador hipotético que tentasse
    // passar um valor livre — createOAuthState só aceita o literal do tipo,
    // então construímos o payload manualmente com o MESMO segredo (o que um
    // atacante sem o segredo nunca conseguiria) só para provar que a
    // VERIFICAÇÃO também fecha essa porta, em profundidade.
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = { v: 1, p: 'meta_oauth', n: 'x'.repeat(10), iat: nowSec, exp: nowSec + 600, f: 'admin_override' };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64url');
    const verified = verifyOAuthState(`${body}.${sig}`, { secret: SECRET });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect('reason' in verified ? verified.reason : undefined).toBe('malformed');
  });

  it('state com flow=review_ui continua exigindo binding correto (mesma proteção anti-CSRF)', () => {
    const state = createOAuthState({ secret: SECRET, binding: BINDING, flow: OAUTH_STATE_FLOW_REVIEW_UI });
    const verified = verifyOAuthState(state, { secret: SECRET, expectedBinding: 'wrong-binding' });
    expect(verified.ok).toBe(false);
  });
});
