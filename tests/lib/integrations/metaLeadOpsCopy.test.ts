// META-MVP1 — textos da operação Lead Ads. Puro.
import { describe, expect, it } from 'vitest';
import { META_LEAD_ERROR_CODES } from '@/lib/server/meta-webhook/error-codes';
import { describeLeadErrorCode, summarizeConnection } from '@/lib/integrations/metaLeadOpsCopy';
import type { MetaConnectionHealth } from '@/lib/integrations/metaLeadOps';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const base: MetaConnectionHealth = {
  integrationId: 'i', pageId: '1', pageName: 'Página', status: 'connected', lastErrorCode: null, lastErrorAt: null,
  connectedAt: null, leadgenSubscribedAt: null, tokenOrigin: 'exchanged_long_lived', tokenExpiresAt: null,
  tokenDataAccessExpiresAt: null, tokenCheckedAt: '2026-11-01T00:00:00.000Z',
};
const inDays = (days: number) => new Date(NOW.getTime() + days * 86400_000).toISOString();

describe('describeLeadErrorCode', () => {
  it('todo código fechado tem título e ação próprios', () => {
    for (const code of META_LEAD_ERROR_CODES) {
      const copy = describeLeadErrorCode(code);
      expect(copy.title).not.toBe('Falha não classificada');
      expect(copy.action.length).toBeGreaterThan(0);
    }
  });

  it('código desconhecido e ausência de código têm textos neutros', () => {
    expect(describeLeadErrorCode('weird').title).toBe('Falha não classificada');
    expect(describeLeadErrorCode(null).title).toBe('Aguardando processamento');
  });
});

describe('summarizeConnection', () => {
  it.each([
    ['conectada sem vencimento', {}, 'green', 'Conectada'],
    ['vence em 60 dias', { tokenDataAccessExpiresAt: inDays(60) }, 'green', 'Conectada'],
    ['vence em 10 dias', { tokenDataAccessExpiresAt: inDays(10) }, 'amber', 'Renovação próxima'],
    ['vencida', { tokenExpiresAt: inDays(-1) }, 'red', 'Credencial vencida'],
    ['nunca verificada', { tokenCheckedAt: null }, 'amber', 'Validade não verificada'],
    ['em erro', { status: 'error', lastErrorCode: 'token_invalid' }, 'red', 'Reconexão necessária'],
    ['permissão ausente', { status: 'error', lastErrorCode: 'permission_missing' }, 'red', 'Reconexão necessária'],
    ['desconectada', { status: 'disconnected' }, 'red', 'Desconectada'],
  ])('%s', (_label, override, tone, label) => {
    expect(summarizeConnection({ ...base, ...override }, NOW)).toMatchObject({ tone, label });
  });
});
