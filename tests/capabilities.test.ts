// Testes das capabilities puras (M1-D, commit 8).
import { describe, expect, it } from 'vitest';
import {
  canAccessFullSettings,
  canAccessStageSettings,
  canReorderPipelineStages,
  canManageInvites,
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
