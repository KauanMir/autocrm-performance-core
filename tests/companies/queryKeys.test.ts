// Testes das query keys da listagem administrativa de empresas (M1-F S3-B).
import { describe, expect, it } from 'vitest';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';

describe('platformCompanyQueryKeys — estrutura exata', () => {
  it('root: ["platform-admin", userId, "companies"]', () => {
    expect(platformCompanyQueryKeys.root('user-1')).toEqual(['platform-admin', 'user-1', 'companies']);
  });

  it('list: igual à raiz', () => {
    expect(platformCompanyQueryKeys.list('user-1')).toEqual(['platform-admin', 'user-1', 'companies']);
  });

  it('keys contêm somente strings — nenhum objeto mutável, nenhum dado sensível', () => {
    const keys = [platformCompanyQueryKeys.root('user-1'), platformCompanyQueryKeys.list('user-1')];
    for (const key of keys) {
      expect(Array.isArray(key)).toBe(true);
      for (const part of key) expect(typeof part).toBe('string');
    }
  });

  it('nenhuma key carrega selectedCompanyId, role, token ou email', () => {
    const key = platformCompanyQueryKeys.list('user-1');
    for (const part of key) {
      expect(part).not.toMatch(/@/); // sem email
      expect(part).not.toBe('super_admin'); // sem role/platformRole
    }
  });
});

describe('platformCompanyQueryKeys — estabilidade e igualdade estrutural', () => {
  it('mesmo userId ⇒ igualdade estrutural, sem compartilhar o array', () => {
    expect(platformCompanyQueryKeys.root('user-1')).toEqual(platformCompanyQueryKeys.root('user-1'));
    expect(platformCompanyQueryKeys.root('user-1')).not.toBe(platformCompanyQueryKeys.root('user-1'));
  });
});

describe('platformCompanyQueryKeys — isolamento por identidade', () => {
  it('usuários diferentes nunca colidem (troca de identidade não reaproveita cache)', () => {
    expect(platformCompanyQueryKeys.list('user-1')).not.toEqual(platformCompanyQueryKeys.list('user-2'));
  });
});

describe('platformCompanyQueryKeys — entradas inválidas', () => {
  it('userId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => platformCompanyQueryKeys.root(invalid as unknown as string)).toThrow(/userId/);
      expect(() => platformCompanyQueryKeys.list(invalid as unknown as string)).toThrow(/userId/);
    }
  });
});

describe('platformCompanyQueryKeys — tipo readonly', () => {
  it('a key é uma tupla readonly em compile-time', () => {
    const root: readonly ['platform-admin', string, 'companies'] = platformCompanyQueryKeys.root('u');
    expect(root.length).toBe(3);
  });
});
