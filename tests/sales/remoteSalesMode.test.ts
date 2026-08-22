// Testes de resolveSalesRemoteMode (COMMERCIAL-REMOTE-SALES-A2). Puro:
// mocka as duas dependências diretas (isRemoteSalesEnabled +
// resolveDealRemoteMode) para controlar deterministicamente a
// tabela-verdade de 4 estados — mesmo padrão de
// tests/deals/remoteDealsMode.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSalesRemoteMode } from '@/lib/sales/remoteSalesMode';

const mocks = vi.hoisted(() => ({
  isRemoteSalesEnabled: vi.fn(),
  resolveDealRemoteMode: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteSalesEnabled: mocks.isRemoteSalesEnabled };
});

vi.mock('@/lib/deals/remoteDealsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/deals/remoteDealsMode')>();
  return { ...actual, resolveDealRemoteMode: mocks.resolveDealRemoteMode };
});

beforeEach(() => {
  mocks.isRemoteSalesEnabled.mockReset();
  mocks.resolveDealRemoteMode.mockReset();
});

describe('resolveSalesRemoteMode — tabela-verdade completa', () => {
  it('Deals=deal_local, Sales=false → sale_local', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_local');
    mocks.isRemoteSalesEnabled.mockReturnValue(false);
    expect(resolveSalesRemoteMode()).toBe('sale_local');
  });

  it('Deals=deal_remote_ready, Sales=false → sale_blocked (rollout parcial esperado, NUNCA local)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    mocks.isRemoteSalesEnabled.mockReturnValue(false);
    expect(resolveSalesRemoteMode()).toBe('sale_blocked');
  });

  it('Deals=deal_remote_ready, Sales=true → sale_remote_ready', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    mocks.isRemoteSalesEnabled.mockReturnValue(true);
    expect(resolveSalesRemoteMode()).toBe('sale_remote_ready');
  });

  it('Deals=deal_local, Sales=true → sale_remote_misconfigured (Sales pediu remoto sem Deals pronto)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_local');
    mocks.isRemoteSalesEnabled.mockReturnValue(true);
    expect(resolveSalesRemoteMode()).toBe('sale_remote_misconfigured');
  });

  it('Deals=deal_blocked, Sales=true → sale_remote_misconfigured (Deals ainda nem remote_ready)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_blocked');
    mocks.isRemoteSalesEnabled.mockReturnValue(true);
    expect(resolveSalesRemoteMode()).toBe('sale_remote_misconfigured');
  });

  it('Deals=deal_remote_misconfigured, Sales=true → sale_remote_misconfigured (propaga)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_misconfigured');
    mocks.isRemoteSalesEnabled.mockReturnValue(true);
    expect(resolveSalesRemoteMode()).toBe('sale_remote_misconfigured');
  });

  it('Deals=deal_remote_misconfigured, Sales=false também propaga (nunca reinterpreta como blocked/local)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_misconfigured');
    mocks.isRemoteSalesEnabled.mockReturnValue(false);
    expect(resolveSalesRemoteMode()).toBe('sale_remote_misconfigured');
  });

  it('nunca escreve nas dependências (somente leitura)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_remote_ready');
    mocks.isRemoteSalesEnabled.mockReturnValue(true);
    resolveSalesRemoteMode();
    expect(mocks.resolveDealRemoteMode).toHaveBeenCalledTimes(1);
    expect(mocks.isRemoteSalesEnabled).toHaveBeenCalledTimes(1);
  });

  it('os 4 valores possíveis são exatamente os 4 estados documentados (sem valor surpresa)', () => {
    const seen = new Set<string>();
    for (const dealsMode of ['deal_local', 'deal_blocked', 'deal_remote_ready', 'deal_remote_misconfigured'] as const) {
      for (const salesEnabled of [true, false]) {
        mocks.resolveDealRemoteMode.mockReturnValue(dealsMode);
        mocks.isRemoteSalesEnabled.mockReturnValue(salesEnabled);
        seen.add(resolveSalesRemoteMode());
      }
    }
    expect(seen).toEqual(
      new Set(['sale_local', 'sale_blocked', 'sale_remote_ready', 'sale_remote_misconfigured']),
    );
  });
});
