// Testes das capabilities puras (M1-D, commit 8).
import { describe, expect, it } from 'vitest';
import {
  canManageCompanySettings,
  canAccessStageSettings,
  canReorderPipelineStages,
  canManageInvites,
  canAccessCommercialWorkspace,
  canMutateCommercialWorkspace,
  membershipLifecycleCapabilities,
  type MembershipLifecycleActor,
  type MembershipLifecycleTargetRow,
  type CommercialMutationCapabilityInput,
} from '@/lib/capabilities';

// M1-F S8-B1: as três capabilities abaixo migraram de User.role (legado)
// para platformRole/activeMembership — mesma identidade de canManageInvites.
// Fixtures não incluem mais `role` (as funções nem o leem) — só os dois
// campos que agora decidem: platformRole e activeMembership.
const superAdmin = { platformRole: 'super_admin', activeMembership: null } as const;
const activeManager = { platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } } as const;
const activeSeller = { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } } as const;
const managerNoMembership = { platformRole: null, activeMembership: null } as const;

describe('canManageCompanySettings — COMPANY-SETTINGS-R1-EXEC', () => {
  it('Manager com membership ATIVA acessa company settings (superfície exclusiva de Manager)', () => {
    expect(canManageCompanySettings(activeManager)).toBe(true);
  });
  it('Super Admin (platformRole=super_admin) NÃO acessa company settings, mesmo sem company context (decisão deliberada, diferente de canAccessStageSettings)', () => {
    expect(canManageCompanySettings(superAdmin)).toBe(false);
  });
  it('Seller com membership ativa não acessa company settings', () => expect(canManageCompanySettings(activeSeller)).toBe(false));
  it('sem membership e sem platformRole: não acessa company settings', () => expect(canManageCompanySettings(managerNoMembership)).toBe(false));
  it('role legado "admin" isolado (sem platformRole/activeMembership) NUNCA concede acesso — a capability nem lê o campo', () => {
    const legacyAdmin = { role: 'admin', platformRole: null, activeMembership: null } as const;
    expect(canManageCompanySettings(legacyAdmin)).toBe(false);
  });
});

describe('canAccessStageSettings — M1-F S8-B1', () => {
  it('Super Admin acessa stage settings, mesmo sem membership', () => expect(canAccessStageSettings(superAdmin)).toBe(true));
  it('Manager com membership ATIVA acessa stage settings', () => expect(canAccessStageSettings(activeManager)).toBe(true));
  it('Manager SEM membership ativa não acessa stage settings', () => expect(canAccessStageSettings(managerNoMembership)).toBe(false));
  it('Seller com membership ativa não acessa stage settings', () => expect(canAccessStageSettings(activeSeller)).toBe(false));
  it('role legado "admin"/"manager" isolado (sem activeMembership/platformRole) NUNCA concede acesso', () => {
    const legacyAdmin = { role: 'admin', platformRole: null, activeMembership: null } as const;
    const legacyManager = { role: 'manager', platformRole: null, activeMembership: null } as const;
    expect(canAccessStageSettings(legacyAdmin)).toBe(false);
    expect(canAccessStageSettings(legacyManager)).toBe(false);
  });
});

describe('canAccessCommercialWorkspace — M1-F S8-C2-B2', () => {
  it('Super Admin acessa o workspace comercial, mesmo sem membership', () => {
    expect(canAccessCommercialWorkspace(superAdmin)).toBe(true);
  });
  it('Manager com membership ATIVA acessa o workspace comercial', () => {
    expect(canAccessCommercialWorkspace(activeManager)).toBe(true);
  });
  it('Seller com membership ATIVA acessa o workspace comercial', () => {
    expect(canAccessCommercialWorkspace(activeSeller)).toBe(true);
  });
  it('sem membership e sem platformRole: não acessa', () => {
    expect(canAccessCommercialWorkspace(managerNoMembership)).toBe(false);
  });
  it('usuário null/undefined: não acessa', () => {
    expect(canAccessCommercialWorkspace(null)).toBe(false);
    expect(canAccessCommercialWorkspace(undefined)).toBe(false);
  });
  it('role legado "admin"/"manager"/"seller" isolado (sem platformRole/activeMembership) NUNCA concede acesso — a capability nem lê o campo', () => {
    const legacyAdmin = { role: 'admin', platformRole: null, activeMembership: null } as const;
    const legacyManager = { role: 'manager', platformRole: null, activeMembership: null } as const;
    const legacySeller = { role: 'seller', platformRole: null, activeMembership: null } as const;
    expect(canAccessCommercialWorkspace(legacyAdmin)).toBe(false);
    expect(canAccessCommercialWorkspace(legacyManager)).toBe(false);
    expect(canAccessCommercialWorkspace(legacySeller)).toBe(false);
  });
  it('a decisão nunca depende de nenhuma feature flag — combinação é sempre do chamador', () => {
    // A própria assinatura não aceita flag alguma; este teste documenta a
    // garantia por ausência de parâmetro (nada a "ligar/desligar" aqui).
    expect(canAccessCommercialWorkspace.length).toBe(1);
  });
});

describe('canMutateCommercialWorkspace — M1-F S8-C2-C2', () => {
  function input(overrides: Partial<CommercialMutationCapabilityInput> = {}): CommercialMutationCapabilityInput {
    return {
      actor: { platformRole: 'super_admin' },
      readEnabled: true,
      writeEnabled: true,
      selectedCompanyStatus: 'ativa',
      ...overrides,
    };
  }

  it('Super Admin + READ + WRITE + empresa ativa: true', () => {
    expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: 'ativa' }))).toBe(true);
  });

  it('Super Admin + READ + WRITE + empresa em implantacao: true', () => {
    expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: 'implantacao' }))).toBe(true);
  });

  it('empresa suspensa: false mesmo com as duas flags ligadas', () => {
    expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: 'suspensa' }))).toBe(false);
  });

  it('empresa cancelada: false mesmo com as duas flags ligadas', () => {
    expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: 'cancelada' }))).toBe(false);
  });

  it('nenhuma empresa selecionada (null): false, nunca inferida', () => {
    expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: null }))).toBe(false);
  });

  it('readEnabled=false: false, mesmo com writeEnabled=true e empresa ativa', () => {
    expect(canMutateCommercialWorkspace(input({ readEnabled: false }))).toBe(false);
  });

  it('writeEnabled=false: false, mesmo com readEnabled=true e empresa ativa', () => {
    expect(canMutateCommercialWorkspace(input({ writeEnabled: false }))).toBe(false);
  });

  it('readEnabled=false e writeEnabled=false: false', () => {
    expect(canMutateCommercialWorkspace(input({ readEnabled: false, writeEnabled: false }))).toBe(false);
  });

  it('Manager com membership ativa: false — capability exclusiva de Super Admin', () => {
    expect(canMutateCommercialWorkspace(input({ actor: { platformRole: null } }))).toBe(false);
  });

  it('actor null/undefined: false', () => {
    expect(canMutateCommercialWorkspace(input({ actor: null }))).toBe(false);
    expect(canMutateCommercialWorkspace(input({ actor: undefined }))).toBe(false);
  });

  it('todas as combinações de status não-mutáveis com as duas flags ligadas', () => {
    (['suspensa', 'cancelada', null] as const).forEach((status) => {
      expect(canMutateCommercialWorkspace(input({ selectedCompanyStatus: status }))).toBe(false);
    });
  });
});

describe('canReorderPipelineStages — M1-F S8-B1', () => {
  it('Super Admin pode reordenar, mesmo sem membership', () => expect(canReorderPipelineStages(superAdmin)).toBe(true));
  it('Manager com membership ATIVA pode reordenar', () => expect(canReorderPipelineStages(activeManager)).toBe(true));
  it('Manager SEM membership ativa não pode reordenar', () => expect(canReorderPipelineStages(managerNoMembership)).toBe(false));
  it('Seller com membership ativa não pode reordenar', () => expect(canReorderPipelineStages(activeSeller)).toBe(false));
  it('companyId legado nunca é lido como autorização (a capability nem aceita o campo)', () => {
    const withStaleCompanyId = { platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } } as const;
    expect(canReorderPipelineStages(withStaleCompanyId)).toBe(true); // autoridade real é activeMembership.role, nunca companyId
  });
});

describe('canManageInvites — M1-F S4-F1', () => {
  it('Super Admin (platformRole=super_admin): true, independente de activeMembership', () => {
    expect(canManageInvites({ platformRole: 'super_admin', activeMembership: null })).toBe(true);
  });

  it('Manager com membership ATIVA (activeMembership.role=manager): true', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } })).toBe(true);
  });

  it('Manager INATIVO (membership suspensa): false — _loadActiveMembership já filtra is_active=true, então uma membership inativa chega aqui como activeMembership=null', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: null })).toBe(false);
  });

  it('Seller (activeMembership.role=seller): false', () => {
    expect(canManageInvites({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } })).toBe(false);
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
    const user = Object.freeze({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager' as const, sellerId: null } });
    canManageInvites(user);
    expect(user).toEqual({ platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } });
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
    expect(canManageCompanySettings(null)).toBe(false);
    expect(canAccessStageSettings(null)).toBe(false);
    expect(canReorderPipelineStages(null)).toBe(false);
  });

  it('undefined retorna false nas três', () => {
    expect(canManageCompanySettings(undefined)).toBe(false);
    expect(canAccessStageSettings(undefined)).toBe(false);
    expect(canReorderPipelineStages(undefined)).toBe(false);
  });

  it('o objeto do usuário não é modificado', () => {
    const user = { role: 'manager' as const };
    const frozen = Object.freeze(user);
    canManageCompanySettings(frozen);
    canAccessStageSettings(frozen);
    canReorderPipelineStages(frozen);
    expect(user).toEqual({ role: 'manager' });
  });
});
