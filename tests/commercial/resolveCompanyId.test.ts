// Testes de resolveCommercialCompanyId (M1-F S8-C2-B2). Função pura — corrige
// o achado do S8-C2-A1 (ScreensOps.tsx lendo currentUser?.companyId legado).
import { describe, expect, it } from 'vitest';
import { resolveCommercialCompanyId } from '@/lib/commercial/resolveCompanyId';

describe('resolveCommercialCompanyId', () => {
  it('Super Admin: usa exclusivamente selectedCompanyId, mesmo com activeMembershipCompanyId presente (nunca deveria estar, mas nunca é lido)', () => {
    expect(resolveCommercialCompanyId({
      isSuperAdmin: true,
      activeMembershipCompanyId: 'company-legacy',
      selectedCompanyId: 'company-selected',
    })).toBe('company-selected');
  });

  it('Super Admin sem seleção: null (nunca cai para activeMembershipCompanyId)', () => {
    expect(resolveCommercialCompanyId({
      isSuperAdmin: true,
      activeMembershipCompanyId: 'company-legacy',
      selectedCompanyId: null,
    })).toBeNull();
  });

  it('Manager/Seller: usa exclusivamente activeMembershipCompanyId, mesmo com selectedCompanyId presente', () => {
    expect(resolveCommercialCompanyId({
      isSuperAdmin: false,
      activeMembershipCompanyId: 'company-a',
      selectedCompanyId: 'company-b',
    })).toBe('company-a');
  });

  it('Manager/Seller sem membership ativa: null (nunca cai para selectedCompanyId)', () => {
    expect(resolveCommercialCompanyId({
      isSuperAdmin: false,
      activeMembershipCompanyId: null,
      selectedCompanyId: 'company-b',
    })).toBeNull();
  });

  it('nenhum fallback cruzado é permitido em nenhuma combinação', () => {
    const combos = [
      { isSuperAdmin: true, activeMembershipCompanyId: null, selectedCompanyId: null },
      { isSuperAdmin: false, activeMembershipCompanyId: null, selectedCompanyId: null },
    ];
    for (const combo of combos) {
      expect(resolveCommercialCompanyId(combo)).toBeNull();
    }
  });
});
