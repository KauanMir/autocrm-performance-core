// Testes de lib/leads/leadFlowContext.ts (M1-E, E4-B2). Função pura — mocka
// lib/flags (única dependência externa, via resolveRemoteLeadsFlagMode) para
// controlar o flagMode determinística. Cobre: dataSource nunca 'local' com a
// flag ligada (mesmo misconfigured/sem identidade), capabilities delegadas a
// resolveLeadMutationCapabilities, campos de identidade extraídos do User.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveLeadFlowContext } from '@/lib/leads/leadFlowContext';
import type { User } from '@/lib/data';

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

function manager(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Manager',
    email: 'm@test.local',
    platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  } as User;
}

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReset();
  mocks.isRemoteStagesEnabled.mockReset();
});

describe('resolveLeadFlowContext — dataSource', () => {
  it('flag desligada: dataSource local', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    const ctx = resolveLeadFlowContext(manager());
    expect(ctx.dataSource).toBe('local');
  });

  it('flag ligada e stages ligada: dataSource remote', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const ctx = resolveLeadFlowContext(manager());
    expect(ctx.dataSource).toBe('remote');
  });

  it('flag ligada mas stages desligada (misconfigured): dataSource AINDA remote — nunca cai para local', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(false);
    const ctx = resolveLeadFlowContext(manager());
    expect(ctx.dataSource).toBe('remote');
    expect(ctx.capabilities.canCreate).toBe(false);
  });

  it('flag ligada sem usuário (sem identidade): dataSource AINDA remote, capabilities todas false', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const ctx = resolveLeadFlowContext(null);
    expect(ctx.dataSource).toBe('remote');
    expect(ctx.capabilities.canCreate).toBe(false);
  });
});

describe('resolveLeadFlowContext — capabilities delegadas', () => {
  it('Manager operacional em remote_ready: canCreate/canEditDetails true', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const ctx = resolveLeadFlowContext(manager());
    expect(ctx.capabilities).toEqual({
      canCreate: true, canEditDetails: true,
      canApplyEvents: false, canMoveStage: false, canAssignSeller: false, canArchive: false,
    });
  });

  it('Super Admin: capabilities todas false', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const ctx = resolveLeadFlowContext(manager({ platformRole: 'super_admin', activeMembership: null }));
    expect(ctx.capabilities.canCreate).toBe(false);
  });
});

describe('resolveLeadFlowContext — campos de identidade', () => {
  it('extrai companyId/membershipRole/sellerId/userId/userIsActive do User', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    mocks.isRemoteStagesEnabled.mockReturnValue(true);
    const ctx = resolveLeadFlowContext(manager({ activeMembership: { companyId: 'company-z', role: 'seller', sellerId: 's9' } }));
    expect(ctx.companyId).toBe('company-z');
    expect(ctx.membershipRole).toBe('seller');
    expect(ctx.sellerId).toBe('s9');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.userIsActive).toBe(true);
  });

  it('user null: todos os campos de identidade neutros', () => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(false);
    const ctx = resolveLeadFlowContext(null);
    expect(ctx.companyId).toBeNull();
    expect(ctx.membershipRole).toBeNull();
    expect(ctx.sellerId).toBeNull();
    expect(ctx.userId).toBeNull();
    expect(ctx.userIsActive).toBe(false);
  });
});
