// Testes das query keys da leitura administrativa de memberships inativas
// (M1-F S6-E). Mesmo padrão de tests/users/queryKeys.test.ts.
import { describe, expect, it } from 'vitest';
import { inactiveCompanyUserQueryKeys } from '@/lib/inactiveUsers/queryKeys';

describe('inactiveCompanyUserQueryKeys — estrutura exata', () => {
  it('root: ["inactive-company-users", userId]', () => {
    expect(inactiveCompanyUserQueryKeys.root('user-1')).toEqual(['inactive-company-users', 'user-1']);
  });

  it('list escopo company: root + "company" + companyId + role + lifecycle + search', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }, null, null, null)).toEqual([
      'inactive-company-users', 'user-1', 'company', 'company-a', 'all', 'all', '',
    ]);
  });

  it('list escopo platform sem filtro de empresa: root + "platform" + "all" + role + lifecycle + search', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'all', 'all', '',
    ]);
  });

  it('list escopo platform com filtro de empresa: companyId aparece na key', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null, null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'company-a', 'all', 'all', '',
    ]);
  });

  it('role filter aparece literalmente na key (manager/seller)', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'manager', null, null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'manager', 'all', '',
    ]);
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'seller', null, null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'seller', 'all', '',
    ]);
  });

  it('lifecycle filter aparece literalmente na key (suspended/offboarded)', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'suspended', null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'all', 'suspended', '',
    ]);
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'offboarded', null)).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'all', 'offboarded', '',
    ]);
  });

  it('busca normalizada (trim + lowercase) aparece na key', () => {
    expect(inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, '  João  ')).toEqual([
      'inactive-company-users', 'user-1', 'platform', 'all', 'all', 'all', 'joão',
    ]);
  });

  it('busca em branco equivale a nenhuma busca (mesma key)', () => {
    const withBlank = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, '   ');
    const withNull = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, null);
    expect(withBlank).toEqual(withNull);
  });
});

describe('inactiveCompanyUserQueryKeys — isolamento de escopo/filtro', () => {
  it('escopo company e escopo platform do MESMO usuário nunca colidem', () => {
    const companyKey = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }, null, null, null);
    const platformKey = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, null);
    expect(companyKey).not.toEqual(platformKey);
  });

  it('companyId diferente (platform) ⇒ key diferente (troca de filtro de empresa não reaproveita cache)', () => {
    const a = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null, null);
    const b = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-b' }, null, null, null);
    expect(a).not.toEqual(b);
  });

  it('role diferente ⇒ key diferente', () => {
    const a = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'manager', null, null);
    const b = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'seller', null, null);
    expect(a).not.toEqual(b);
  });

  it('lifecycle diferente ⇒ key diferente (suspended nunca reaproveita cache de offboarded)', () => {
    const a = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'suspended', null);
    const b = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'offboarded', null);
    expect(a).not.toEqual(b);
  });

  it('busca diferente ⇒ key diferente', () => {
    const a = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, 'ana');
    const b = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, 'bruno');
    expect(a).not.toEqual(b);
  });

  it('usuários diferentes nunca colidem, mesmo escopo/filtro idênticos', () => {
    const scope = { kind: 'company', companyId: 'company-a' } as const;
    expect(inactiveCompanyUserQueryKeys.list('user-1', scope, null, null, null))
      .not.toEqual(inactiveCompanyUserQueryKeys.list('user-2', scope, null, null, null));
  });

  it('nunca colide com a key de companyUserQueryKeys (namespaces raiz distintos)', () => {
    const inactiveKey = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, null);
    expect(inactiveKey[0]).toBe('inactive-company-users');
    expect(inactiveKey[0]).not.toBe('company-users');
  });
});

describe('inactiveCompanyUserQueryKeys — entradas inválidas', () => {
  it('userId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => inactiveCompanyUserQueryKeys.root(invalid as unknown as string)).toThrow(/userId/);
      expect(() =>
        inactiveCompanyUserQueryKeys.list(invalid as unknown as string, { kind: 'platform', companyId: null }, null, null, null),
      ).toThrow(/userId/);
    }
  });

  it('companyId vazio, em branco, null ou undefined no escopo company ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() =>
        inactiveCompanyUserQueryKeys.list('user-1', { kind: 'company', companyId: invalid as unknown as string }, null, null, null),
      ).toThrow(/companyId/);
    }
  });
});

// ── M1-F S7-B — compatibilidade com o companyFilterId de useCompanyScopeFilter ─
// Mesmo contrato de tests/users/queryKeys.test.ts: companyFilterId
// (string | null) é atribuível direto a scope.companyId no escopo
// 'platform', produzindo keys distintas para visão global vs. empresa A/B.

describe('inactiveCompanyUserQueryKeys — compatibilidade com companyFilterId (visão global vs. empresa A/B)', () => {
  it('visão global (companyFilterId=null) e empresa A/B produzem keys distintas entre si', () => {
    const global = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null, null);
    const companyA = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null, null);
    const companyB = inactiveCompanyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-b' }, null, null, null);

    expect(global).not.toEqual(companyA);
    expect(companyA).not.toEqual(companyB);
    expect(global).not.toEqual(companyB);
  });
});
