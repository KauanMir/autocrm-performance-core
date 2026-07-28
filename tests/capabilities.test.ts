// Testes das capabilities puras (M1-D, commit 8).
import { describe, expect, it } from 'vitest';
import {
  canAccessFullSettings,
  canAccessStageSettings,
  canReorderPipelineStages,
  canManageInvites,
  membershipLifecycleCapabilities,
  type MembershipLifecycleActor,
  type MembershipLifecycleTargetRow,
} from '@/lib/capabilities';

const admin = { role: 'admin' } as const;
const manager = { role: 'manager' } as const;
const seller = { role: 'seller' } as const;

describe('canAccessFullSettings', () => {
  it('admin acessa full settings', () => expect(canAccessFullSettings(admin)).toBe(true));
  it('manager não acessa full settings', () => expect(canAccessFullSettings(manager)).toBe(false));
  it('seller não acessa full settings', () => expect(canAccessFullSettings(seller)).toBe(false));
});

describe('canAccessStageSettings', () => {
  it('admin acessa stage settings', () => expect(canAccessStageSettings(admin)).toBe(true));
  it('manager acessa stage settings', () => expect(canAccessStageSettings(manager)).toBe(true));
  it('seller não acessa stage settings', () => expect(canAccessStageSettings(seller)).toBe(false));
});

describe('canReorderPipelineStages', () => {
  it('admin pode reordenar', () => expect(canReorderPipelineStages(admin)).toBe(true));
  it('manager pode reordenar', () => expect(canReorderPipelineStages(manager)).toBe(true));
  it('seller não pode reordenar', () => expect(canReorderPipelineStages(seller)).toBe(false));
});

describe('canManageInvites — M1-F S4-F1', () => {
  it('Super Admin (platformRole=super_admin): true, independente de activeMembership', () => {
    expect(canManageInvites({ platformRole: 'super_admin', activeMembership: null })).toBe(true);
  });

  it('Manager com membership ATIVA (activeMembership.role=manager): true', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' } })).toBe(true);
  });

  it('Manager INATIVO (membership suspensa): false — _loadActiveMembership já filtra is_active=true, então uma membership inativa chega aqui como activeMembership=null', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: null })).toBe(false);
  });

  it('Seller (activeMembership.role=seller): false', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller' } })).toBe(false);
  });

  it('Auth user sem profile/membership (activeMembership undefined): false', () => {
    expect(canManageInvites({ platformRole: undefined, activeMembership: undefined })).toBe(false);
  });

  it('null/undefined (anon ou sessão não resolvida): false', () => {
    expect(canManageInvites(null)).toBe(false);
    expect(canManageInvites(undefined)).toBe(false);
  });

  it('legado profiles.role="admin" SOZINHO, sem activeMembership, NUNCA concede acesso — a capability nem lê o campo role', () => {
    const legacyAdminWithoutMembership = { role: 'admin', platformRole: null, activeMembership: null } as const;
    expect(canManageInvites(legacyAdminWithoutMembership)).toBe(false);
  });

  it('legado profiles.role="manager" SOZINHO, sem activeMembership, NUNCA concede acesso', () => {
    const legacyManagerWithoutMembership = { role: 'manager', platformRole: null, activeMembership: null } as const;
    expect(canManageInvites(legacyManagerWithoutMembership)).toBe(false);
  });

  it('o objeto do usuário não é modificado', () => {
    const user = Object.freeze({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' as const } });
    canManageInvites(user);
    expect(user).toEqual({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' } });
  });
});

// ── M1-F S6-F — membershipLifecycleCapabilities (ciclo de vida empresarial) ─

const SUPER_ADMIN: MembershipLifecycleActor = { kind: 'super_admin', profileId: 'admin-1' };
const MANAGER: MembershipLifecycleActor = { kind: 'manager', profileId: 'manager-1', companyId: 'company-a' };

function target(overrides: Partial<MembershipLifecycleTargetRow> = {}): MembershipLifecycleTargetRow {
  return {
    profileId: 'target-1',
    companyId: 'company-a',
    companyRole: 'seller',
    lifecycleStatus: 'active',
    ...overrides,
  };
}

describe('membershipLifecycleCapabilities — ator null', () => {
  it('actor null: nenhuma capability', () => {
    expect(membershipLifecycleCapabilities(target(), null)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });
});

describe('membershipLifecycleCapabilities — Super Admin', () => {
  it('alvo ativo: Suspender/Desligar/Transferir, nunca Reativar', () => {
    expect(membershipLifecycleCapabilities(target({ lifecycleStatus: 'active' }), SUPER_ADMIN)).toEqual({
      canSuspend: true, canReactivate: false, canOffboard: true, canTransfer: true,
    });
  });

  it('alvo suspenso: Reativar/Desligar/Transferir, nunca Suspender', () => {
    expect(membershipLifecycleCapabilities(target({ lifecycleStatus: 'suspended' }), SUPER_ADMIN)).toEqual({
      canSuspend: false, canReactivate: true, canOffboard: true, canTransfer: true,
    });
  });

  it('alvo desligado: somente leitura (nenhuma ação)', () => {
    expect(membershipLifecycleCapabilities(target({ lifecycleStatus: 'offboarded' }), SUPER_ADMIN)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });

  it('funciona igual para alvo Manager (Super Admin atua sobre qualquer papel/empresa)', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'manager', companyId: 'outra-empresa', lifecycleStatus: 'active' }), SUPER_ADMIN)).toEqual({
      canSuspend: true, canReactivate: false, canOffboard: true, canTransfer: true,
    });
  });

  it('nunca sobre a própria membership (self)', () => {
    expect(membershipLifecycleCapabilities(target({ profileId: 'admin-1' }), SUPER_ADMIN)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });
});

describe('membershipLifecycleCapabilities — Manager', () => {
  it('Seller ativo da própria empresa: Suspender/Desligar, nunca Reativar/Transferir', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'seller', companyId: 'company-a', lifecycleStatus: 'active' }), MANAGER)).toEqual({
      canSuspend: true, canReactivate: false, canOffboard: true, canTransfer: false,
    });
  });

  it('Seller suspenso da própria empresa: Reativar/Desligar, nunca Suspender/Transferir', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'seller', companyId: 'company-a', lifecycleStatus: 'suspended' }), MANAGER)).toEqual({
      canSuspend: false, canReactivate: true, canOffboard: true, canTransfer: false,
    });
  });

  it('Seller desligado: somente leitura', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'seller', companyId: 'company-a', lifecycleStatus: 'offboarded' }), MANAGER)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });

  it('NUNCA sobre outro Manager (mesma empresa)', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'manager', companyId: 'company-a', lifecycleStatus: 'active' }), MANAGER)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });

  it('NUNCA fora da própria empresa (mesmo Seller ativo)', () => {
    expect(membershipLifecycleCapabilities(target({ companyRole: 'seller', companyId: 'outra-empresa', lifecycleStatus: 'active' }), MANAGER)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });

  it('NUNCA transferência, mesmo com todas as outras condições satisfeitas', () => {
    const caps = membershipLifecycleCapabilities(target({ companyRole: 'seller', companyId: 'company-a', lifecycleStatus: 'active' }), MANAGER);
    expect(caps.canTransfer).toBe(false);
  });

  it('NUNCA sobre a própria membership (self)', () => {
    expect(membershipLifecycleCapabilities(target({ profileId: 'manager-1', companyRole: 'seller', companyId: 'company-a' }), MANAGER)).toEqual({
      canSuspend: false, canReactivate: false, canOffboard: false, canTransfer: false,
    });
  });
});

describe('entradas nulas e integridade', () => {
  it('null retorna false nas três', () => {
    expect(canAccessFullSettings(null)).toBe(false);
    expect(canAccessStageSettings(null)).toBe(false);
    expect(canReorderPipelineStages(null)).toBe(false);
  });

  it('undefined retorna false nas três', () => {
    expect(canAccessFullSettings(undefined)).toBe(false);
    expect(canAccessStageSettings(undefined)).toBe(false);
    expect(canReorderPipelineStages(undefined)).toBe(false);
  });

  it('o objeto do usuário não é modificado', () => {
    const user = { role: 'manager' as const };
    const frozen = Object.freeze(user);
    canAccessFullSettings(frozen);
    canAccessStageSettings(frozen);
    canReorderPipelineStages(frozen);
    expect(user).toEqual({ role: 'manager' });
  });
});
