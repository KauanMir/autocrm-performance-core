// Testes de resolveVisitRemoteMode (COMMERCIAL-REMOTE-VISITS-B2-A). Puro:
// mocka as duas dependências diretas (isRemoteVisitsEnabled +
// resolveRemoteLeadsFlagMode) para controlar deterministicamente a
// tabela-verdade de 4 estados — mesmo padrão de
// tests/tasks/remoteTasksMode.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';

const mocks = vi.hoisted(() => ({
  isRemoteVisitsEnabled: vi.fn(),
  resolveRemoteLeadsFlagMode: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteVisitsEnabled: mocks.isRemoteVisitsEnabled };
});

vi.mock('@/lib/leads/remoteLeadsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/leads/remoteLeadsMode')>();
  return { ...actual, resolveRemoteLeadsFlagMode: mocks.resolveRemoteLeadsFlagMode };
});

beforeEach(() => {
  mocks.isRemoteVisitsEnabled.mockReset();
  mocks.resolveRemoteLeadsFlagMode.mockReset();
});

describe('resolveVisitRemoteMode — tabela-verdade completa', () => {
  it('Leads=local, Visits=false → visit_local', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteVisitsEnabled.mockReturnValue(false);
    expect(resolveVisitRemoteMode()).toBe('visit_local');
  });

  it('Leads=remote_ready, Visits=false → visit_blocked (rollout parcial esperado, NUNCA local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteVisitsEnabled.mockReturnValue(false);
    expect(resolveVisitRemoteMode()).toBe('visit_blocked');
  });

  it('Leads=remote_ready, Visits=true → visit_remote_ready', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteVisitsEnabled.mockReturnValue(true);
    expect(resolveVisitRemoteMode()).toBe('visit_remote_ready');
  });

  it('Leads=local, Visits=true → visit_remote_misconfigured (Visits pediu remoto sem Leads pronto)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('local');
    mocks.isRemoteVisitsEnabled.mockReturnValue(true);
    expect(resolveVisitRemoteMode()).toBe('visit_remote_misconfigured');
  });

  it('Leads=remote_misconfigured, Visits=true → visit_remote_misconfigured (propaga)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteVisitsEnabled.mockReturnValue(true);
    expect(resolveVisitRemoteMode()).toBe('visit_remote_misconfigured');
  });

  it('Leads=remote_misconfigured, Visits=false também propaga (nunca reinterpreta como blocked/local)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_misconfigured');
    mocks.isRemoteVisitsEnabled.mockReturnValue(false);
    expect(resolveVisitRemoteMode()).toBe('visit_remote_misconfigured');
  });

  it('nunca escreve nas dependências (somente leitura)', () => {
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteVisitsEnabled.mockReturnValue(true);
    resolveVisitRemoteMode();
    expect(mocks.resolveRemoteLeadsFlagMode).toHaveBeenCalledTimes(1);
    expect(mocks.isRemoteVisitsEnabled).toHaveBeenCalledTimes(1);
  });

  it('sem dependência de isRemoteTasksEnabled — Visits nunca consulta Tasks', async () => {
    const flags = await import('@/lib/flags');
    const spy = vi.spyOn(flags, 'isRemoteTasksEnabled');
    mocks.resolveRemoteLeadsFlagMode.mockReturnValue('remote_ready');
    mocks.isRemoteVisitsEnabled.mockReturnValue(true);
    resolveVisitRemoteMode();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('os 4 valores possíveis são exatamente os 4 estados documentados (sem valor surpresa)', () => {
    const seen = new Set<string>();
    for (const leadsMode of ['local', 'remote_ready', 'remote_misconfigured'] as const) {
      for (const visitsEnabled of [true, false]) {
        mocks.resolveRemoteLeadsFlagMode.mockReturnValue(leadsMode);
        mocks.isRemoteVisitsEnabled.mockReturnValue(visitsEnabled);
        seen.add(resolveVisitRemoteMode());
      }
    }
    expect(seen).toEqual(
      new Set(['visit_local', 'visit_blocked', 'visit_remote_ready', 'visit_remote_misconfigured']),
    );
  });
});
