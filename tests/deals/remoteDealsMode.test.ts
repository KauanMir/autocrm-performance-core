// Testes de resolveDealRemoteMode (COMMERCIAL-REMOTE-DEALS-B2-A). Puro:
// mocka as duas dependências diretas (isRemoteDealsEnabled +
// resolveRemoteLeadsFlagMode) para controlar deterministicamente a
// tabela-verdade de 4 estados — mesmo padrão de
// tests/visits/remoteVisitsMode.test.ts/tests/tasks/remoteTasksMode.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';

const mocks = vi.hoisted(() => ({
  isRemoteDealsEnabled: vi.fn(),
  resolveRemoteLeadsFlagMode: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteDealsEnabled: mocks.isRemoteDealsEnabled };
});

vi.mock('@/lib/leads/remoteLeadsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leads/remoteLeadsMode')>();
  return { ...actual, resolveRemoteLeadsFlagMode: mocks.resolveRemoteLeadsFlagMode };
});

beforeEach(() => {
  mocks.isRemoteDealsEnabled.mockReset();
  mocks.resolveRemoteLeadsFlagMode.mockReset();
});

describe('resolveDealRemoteMode — tabela-verdade completa', () => {
  it('Leads=local, Deals=false → deal_local', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteDealsEnabled.mockReturnValue(false);
    expect(resolveDealRemoteMode()).toBe('deal_local');
  });

  it('Leads=remote_ready, Deals=false → deal_blocked (rollout parcial esperado, NUNCA local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteDealsEnabled.mockReturnValue(false);
    expect(resolveDealRemoteMode()).toBe('deal_blocked');
  });

  it('Leads=remote_ready, Deals=true → deal_remote_ready', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteDealsEnabled.mockReturnValue(true);
    expect(resolveDealRemoteMode()).toBe('deal_remote_ready');
  });

  it('Leads=local, Deals=true → deal_remote_misconfigured (Deals pediu remoto sem Leads pronto)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteDealsEnabled.mockReturnValue(true);
    expect(resolveDealRemoteMode()).toBe('deal_remote_misconfigured');
  });

  it('Leads=remote_misconfigured, Deals=true → deal_remote_misconfigured (propaga)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteDealsEnabled.mockReturnValue(true);
    expect(resolveDealRemoteMode()).toBe('deal_remote_misconfigured');
  });

  it('Leads=remote_misconfigured, Deals=false também propaga (nunca reinterpreta como blocked/local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteDealsEnabled.mockReturnValue(false);
    expect(resolveDealRemoteMode()).toBe('deal_remote_misconfigured');
  });

  it('nunca escreve nas dependências (somente leitura)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteDealsEnabled.mockReturnValue(true);
    resolveDealRemoteMode();
    expect(mocks.resolveRemoteLeadsFlagMode).toHaveBeenCalledTimes(1);
    expect(mocks.isRemoteDealsEnabled).toHaveBeenCalledTimes(1);
  });

  it('sem dependência de isRemoteVisitsEnabled/isRemoteTasksEnabled — Deals nunca consulta outros domínios', async () => {
    const flags = await import('@/lib/flags');
    const visitsSpy = vi.spyOn(flags, 'isRemoteVisitsEnabled');
    const tasksSpy = vi.spyOn(flags, 'isRemoteTasksEnabled');
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteDealsEnabled.mockReturnValue(true);
    resolveDealRemoteMode();
    expect(visitsSpy).not.toHaveBeenCalled();
    expect(tasksSpy).not.toHaveBeenCalled();
    visitsSpy.mockRestore();
    tasksSpy.mockRestore();
  });

  it('os 4 valores possíveis são exatamente os 4 estados documentados (sem valor surpresa)', () => {
    const seen = new Set<string>();
    for (const leadsMode of ['local', 'remote_ready', 'remote_misconfigured'] as const) {
      for (const dealsEnabled of [true, false]) {
        mocks.resolveRemoteLeadsFlagMode.mockReturnValue(leadsMode);
        mocks.isRemoteDealsEnabled.mockReturnValue(dealsEnabled);
        seen.add(resolveDealRemoteMode());
      }
    }
    expect(seen).toEqual(
      new Set(['deal_local', 'deal_blocked', 'deal_remote_ready', 'deal_remote_misconfigured']),
    );
  });
});
