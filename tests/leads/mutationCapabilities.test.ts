// Testes de lib/leads/mutationCapabilities.ts (M1-E, E4-B1 + E5-B1 +
// E5-B2-A2 + E6-B2-A). Função pura — sem mocks de rede/React. Cobre a
// matriz completa: canCreate/canEditDetails/canMoveStage/canLogCallOutcome
// podem ser true (canMoveStage ativado no E5-B1, canLogCallOutcome no
// E5-B2-A2); canAssignSeller/canArchive ativados no E6-B2-A, MAS
// Manager-only (nunca Seller, mesmo operacional — assign_lead_seller/
// archive_lead/unarchive_lead proíbem Seller de forma incondicional no
// backend); canApplyEvents é SEMPRE false neste módulo (E5-B2-B).
import { describe, expect, it } from 'vitest';
import {
  resolveLeadMutationCapabilities,
  type ResolveLeadMutationCapabilitiesInput,
} from '@/lib/leads/mutationCapabilities';

const ALL_FALSE = {
  canCreate: false,
  canEditDetails: false,
  canApplyEvents: false,
  canMoveStage: false,
  canLogCallOutcome: false,
  canAssignSeller: false,
  canArchive: false,
};

function baseInput(
  overrides: Partial<ResolveLeadMutationCapabilitiesInput> = {},
): ResolveLeadMutationCapabilitiesInput {
  return {
    flagMode: 'remote_ready',
    profileIsActive: true,
    actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } },
    ...overrides,
  };
}

describe('resolveLeadMutationCapabilities — Manager operacional', () => {
  it('canCreate, canEditDetails, canMoveStage, canLogCallOutcome, canAssignSeller e canArchive true; canApplyEvents false', () => {
    const result = resolveLeadMutationCapabilities(baseInput());
    expect(result).toEqual({
      ...ALL_FALSE,
      canCreate: true, canEditDetails: true, canMoveStage: true, canLogCallOutcome: true,
      canAssignSeller: true, canArchive: true,
    });
  });
});

describe('resolveLeadMutationCapabilities — Seller operacional com sellerId válido', () => {
  it('canCreate, canEditDetails, canMoveStage e canLogCallOutcome true; demais false', () => {
    const input = baseInput({
      actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } },
    });
    expect(resolveLeadMutationCapabilities(input)).toEqual({ ...ALL_FALSE, canCreate: true, canEditDetails: true, canMoveStage: true, canLogCallOutcome: true });
  });
});

describe('resolveLeadMutationCapabilities — Seller sem sellerId', () => {
  it('todas false', () => {
    const input = baseInput({
      actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } },
    });
    expect(resolveLeadMutationCapabilities(input)).toEqual(ALL_FALSE);
  });
});

describe('resolveLeadMutationCapabilities — Super Admin', () => {
  it('todas false mesmo em modo remote_ready (usa componentes Platform separados)', () => {
    const input = baseInput({ actor: { platformRole: 'super_admin', activeMembership: null } });
    expect(resolveLeadMutationCapabilities(input)).toEqual(ALL_FALSE);
  });
});

describe('resolveLeadMutationCapabilities — sem membership/suspenso/offboarded/inativo', () => {
  it('sem activeMembership: todas false', () => {
    const input = baseInput({ actor: { platformRole: null, activeMembership: null } });
    expect(resolveLeadMutationCapabilities(input)).toEqual(ALL_FALSE);
  });

  it('actor null/undefined: todas false', () => {
    expect(resolveLeadMutationCapabilities(baseInput({ actor: null }))).toEqual(ALL_FALSE);
    expect(resolveLeadMutationCapabilities(baseInput({ actor: undefined }))).toEqual(ALL_FALSE);
  });

  it('profile inativo: todas false mesmo com activeMembership presente', () => {
    expect(resolveLeadMutationCapabilities(baseInput({ profileIsActive: false }))).toEqual(ALL_FALSE);
  });
});

describe('resolveLeadMutationCapabilities — modo de flag', () => {
  it('modo local: todas false (caminho local não é alterado por este módulo)', () => {
    expect(resolveLeadMutationCapabilities(baseInput({ flagMode: 'local' }))).toEqual(ALL_FALSE);
  });

  it('remote_misconfigured: todas false', () => {
    expect(resolveLeadMutationCapabilities(baseInput({ flagMode: 'remote_misconfigured' }))).toEqual(ALL_FALSE);
  });
});

describe('resolveLeadMutationCapabilities — canApplyEvents permanece fora deste módulo (E5-B2-B)', () => {
  it('nenhuma combinação válida libera canApplyEvents (canMoveStage/canLogCallOutcome já ativados, canApplyEvents nunca)', () => {
    const managerResult = resolveLeadMutationCapabilities(baseInput());
    const sellerResult = resolveLeadMutationCapabilities(
      baseInput({ actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } } }),
    );
    for (const result of [managerResult, sellerResult]) {
      expect(result.canApplyEvents).toBe(false);
      expect(result.canMoveStage).toBe(true);
      expect(result.canLogCallOutcome).toBe(true);
    }
  });
});

describe('resolveLeadMutationCapabilities — E6-B2-A: canAssignSeller/canArchive são Manager-only', () => {
  it('Manager operacional: canAssignSeller e canArchive true', () => {
    const result = resolveLeadMutationCapabilities(baseInput());
    expect(result.canAssignSeller).toBe(true);
    expect(result.canArchive).toBe(true);
  });

  it('Seller operacional com sellerId válido: canAssignSeller e canArchive continuam false (proibição incondicional no backend, não é questão de posse)', () => {
    const input = baseInput({
      actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } },
    });
    const result = resolveLeadMutationCapabilities(input);
    expect(result.canAssignSeller).toBe(false);
    expect(result.canArchive).toBe(false);
  });
});
