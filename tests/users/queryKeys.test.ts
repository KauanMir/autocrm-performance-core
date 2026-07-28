// Testes das query keys da listagem administrativa de usuários ativos
// (M1-F S5-D).
import { describe, expect, it } from 'vitest';
import { companyUserQueryKeys } from '@/lib/users/queryKeys';

describe('companyUserQueryKeys — estrutura exata', () => {
  it('root: ["company-users", userId]', () => {
    expect(companyUserQueryKeys.root('user-1')).toEqual(['company-users', 'user-1']);
  });

  it('list escopo company: root + "company" + companyId + role + search', () => {
    expect(companyUserQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }, null, null)).toEqual([
      'company-users', 'user-1', 'company', 'company-a', 'all', '',
    ]);
  });

  it('list escopo platform sem filtro de empresa: root + "platform" + "all" + role + search', () => {
    expect(companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null)).toEqual([
      'company-users', 'user-1', 'platform', 'all', 'all', '',
    ]);
  });

  it('list escopo platform com filtro de empresa: companyId aparece na key', () => {
    expect(companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null)).toEqual([
      'company-users', 'user-1', 'platform', 'company-a', 'all', '',
    ]);
  });

  it('role filter aparece literalmente na key (manager/seller)', () => {
    expect(companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'manager', null)).toEqual([
      'company-users', 'user-1', 'platform', 'all', 'manager', '',
    ]);
    expect(companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'seller', null)).toEqual([
      'company-users', 'user-1', 'platform', 'all', 'seller', '',
    ]);
  });

  it('busca normalizada (trim + lowercase) aparece na key', () => {
    expect(companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, '  João  ')).toEqual([
      'company-users', 'user-1', 'platform', 'all', 'all', 'joão',
    ]);
  });

  it('busca em branco equivale a nenhuma busca (mesma key)', () => {
    const withBlank = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, '   ');
    const withNull = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null);
    expect(withBlank).toEqual(withNull);
  });
});

describe('companyUserQueryKeys — isolamento de escopo/filtro', () => {
  it('escopo company e escopo platform do MESMO usuário nunca colidem', () => {
    const companyKey = companyUserQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }, null, null);
    const platformKey = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null);
    expect(companyKey).not.toEqual(platformKey);
  });

  it('companyId diferente (platform) ⇒ key diferente (troca de filtro de empresa não reaproveita cache)', () => {
    const a = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null);
    const b = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-b' }, null, null);
    expect(a).not.toEqual(b);
  });

  it('role diferente ⇒ key diferente', () => {
    const a = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'manager', null);
    const b = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, 'seller', null);
    expect(a).not.toEqual(b);
  });

  it('busca diferente ⇒ key diferente', () => {
    const a = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'ana');
    const b = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, 'bruno');
    expect(a).not.toEqual(b);
  });

  it('usuários diferentes nunca colidem, mesmo escopo/filtro idênticos', () => {
    const scope = { kind: 'company', companyId: 'company-a' } as const;
    expect(companyUserQueryKeys.list('user-1', scope, null, null))
      .not.toEqual(companyUserQueryKeys.list('user-2', scope, null, null));
  });
});

describe('companyUserQueryKeys — entradas inválidas', () => {
  it('userId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => companyUserQueryKeys.root(invalid as unknown as string)).toThrow(/userId/);
      expect(() =>
        companyUserQueryKeys.list(invalid as unknown as string, { kind: 'platform', companyId: null }, null, null),
      ).toThrow(/userId/);
    }
  });

  it('companyId vazio, em branco, null ou undefined no escopo company ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() =>
        companyUserQueryKeys.list('user-1', { kind: 'company', companyId: invalid as unknown as string }, null, null),
      ).toThrow(/companyId/);
    }
  });
});

// ── M1-F S7-B — compatibilidade com o companyFilterId de useCompanyScopeFilter ─
// companyFilterId (string | null) é atribuível direto a scope.companyId no
// escopo 'platform' — visão global (null) e empresa A/B produzem keys
// distintas, exatamente o contrato que o filtro contextual (S7) vai
// consumir quando integrado (S7-C), sem exigir nenhum key builder novo.

describe('companyUserQueryKeys — compatibilidade com companyFilterId (visão global vs. empresa A/B)', () => {
  it('visão global (companyFilterId=null) e empresa A/B produzem keys distintas entre si', () => {
    const global = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: null }, null, null);
    const companyA = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-a' }, null, null);
    const companyB = companyUserQueryKeys.list('user-1', { kind: 'platform', companyId: 'company-b' }, null, null);

    expect(global).not.toEqual(companyA);
    expect(companyA).not.toEqual(companyB);
    expect(global).not.toEqual(companyB);
  });
});
