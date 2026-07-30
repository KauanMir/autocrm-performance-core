// Testes de lib/leads/mutationCapabilities.ts (M1-E, E4-B1). Função pura —
// sem mocks de rede/React. Cobre a matriz completa do E4: só
// canCreate/canEditDetails podem ser true; canApplyEvents/canMoveStage/
// canAssignSeller/canArchive são SEMPRE false neste módulo (E5/E6).
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
  it('canCreate e canEditDetails true; demais false', () => {
    const result = resolveLeadMutationCapabilities(baseInput());
    expect(result).toEqual({ ...ALL_FALSE, canCreate: true, canEditDetails: true });
  });
});

describe('resolveLeadMutationCapabilities — Seller operacional com sellerId válido', () => {
  it('canCreate e canEditDetails true; demais false', () => {
    const input = baseInput({
      actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } },
    });
    expect(resolveLeadMutationCapabilities(input)).toEqual({ ...ALL_FALSE, canCreate: true, canEditDetails: true });
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

describe('resolveLeadMutationCapabilities — E5/E6 permanecem fora do E4', () => {
  it('nenhuma combinação válida libera canApplyEvents/canMoveStage/canAssignSeller/canArchive', () => {
    const managerResult = resolveLeadMutationCapabilities(baseInput());
    const sellerResult = resolveLeadMutationCapabilities(
      baseInput({ actor: { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } } }),
    );
    for (const result of [managerResult, sellerResult]) {
      expect(result.canApplyEvents).toBe(false);
      expect(result.canMoveStage).toBe(false);
      expect(result.canAssignSeller).toBe(false);
      expect(result.canArchive).toBe(false);
    }
  });
});
