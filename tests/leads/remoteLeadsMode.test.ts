// Testes de resolveRemoteLeadsFlagMode (M1-E, E3-B1). Puro: mocka as duas
// flags reais diretamente, sem tocar process.env/localStorage (já cobertos
// em tests/flags.test.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

const mocks = vi.hoisted(() => ({
  isRemoteLeadsEnabled: vi.fn(),
  isRemoteStagesEnabled: vi.fn(),
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...actual,
    isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled,
    isRemoteStagesEnabled: mocks.isRemoteStagesEnabled,
  };
});

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReset();
  mocks.isRemoteStagesEnabled.mockReset();
});

describe('resolveRemoteLeadsFlagMode', () => {
  it('REMOTE_LEADS=false → local, independente de REMOTE_STAGES', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    expect(resolveRemoteLeadsFlagMode()).toBe('local');

    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    expect(resolveRemoteLeadsFlagMode()).toBe('local');
  });

  it('REMOTE_LEADS=true e REMOTE_STAGES=true → remote_ready', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    expect(resolveRemoteLeadsFlagMode()).toBe('remote_ready');
  });

  it('REMOTE_LEADS=true e REMOTE_STAGES=false → remote_misconfigured (falha fechada)', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    expect(resolveRemoteLeadsFlagMode()).toBe('remote_misconfigured');
  });

  it('nunca altera o valor das flags (chamadas somente de leitura)', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    resolveRemoteLeadsFlagMode();
    expect(mocks.isRemoteLeadsEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.isRemoteStagesEnabled).toHaveBeenCalledTimes(1);
  });
});
