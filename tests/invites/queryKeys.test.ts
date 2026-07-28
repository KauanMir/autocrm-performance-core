// Testes das query keys da listagem administrativa de convites (M1-F S4-F1).
import { describe, expect, it } from 'vitest';
import { adminInviteQueryKeys } from '@/lib/invites/queryKeys';

describe('adminInviteQueryKeys — estrutura exata', () => {
  it('root: ["admin-invites", userId]', () => {
    expect(adminInviteQueryKeys.root('user-1')).toEqual(['admin-invites', 'user-1']);
  });

  it('list escopo company: root + "company" + companyId', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' })).toEqual([
      'admin-invites', 'user-1', 'company', 'company-a',
    ]);
  });

  it('list escopo platform: root + "platform"', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'platform' })).toEqual([
      'admin-invites', 'user-1', 'platform',
    ]);
  });

  it('keys contêm somente strings — nenhum objeto mutável, nenhum dado sensível', () => {
    const keys = [
      adminInviteQueryKeys.root('user-1'),
      adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }),
      adminInviteQueryKeys.list('user-1', { kind: 'platform' }),
    ];
    for (const key of keys) {
      expect(Array.isArray(key)).toBe(true);
      for (const part of key) expect(typeof part).toBe('string');
    }
  });

  it('nenhuma key carrega e-mail, token/hash ou role', () => {
    const key = adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' });
    for (const part of key) {
      expect(part).not.toMatch(/@/);
      expect(part).not.toMatch(/token|hash/i);
      expect(part).not.toBe('manager');
      expect(part).not.toBe('super_admin');
    }
  });
});

describe('adminInviteQueryKeys — isolamento de escopo', () => {
  it('escopo company e escopo platform do MESMO usuário nunca colidem', () => {
    const companyKey = adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' });
    const platformKey = adminInviteQueryKeys.list('user-1', { kind: 'platform' });
    expect(companyKey).not.toEqual(platformKey);
  });

  it('companyId diferente ⇒ key diferente (troca de empresa não reaproveita cache)', () => {
    const a = adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' });
    const b = adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-b' });
    expect(a).not.toEqual(b);
  });

  it('usuários diferentes nunca colidem, mesmo escopo idêntico', () => {
    const scope = { kind: 'company', companyId: 'company-a' } as const;
    expect(adminInviteQueryKeys.list('user-1', scope)).not.toEqual(adminInviteQueryKeys.list('user-2', scope));
  });
});

describe('adminInviteQueryKeys — estabilidade e igualdade estrutural', () => {
  it('mesmos argumentos ⇒ igualdade estrutural, sem compartilhar o array', () => {
    expect(adminInviteQueryKeys.root('user-1')).toEqual(adminInviteQueryKeys.root('user-1'));
    expect(adminInviteQueryKeys.root('user-1')).not.toBe(adminInviteQueryKeys.root('user-1'));
  });
});

describe('adminInviteQueryKeys — entradas inválidas', () => {
  it('userId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => adminInviteQueryKeys.root(invalid as unknown as string)).toThrow(/userId/);
      expect(() => adminInviteQueryKeys.list(invalid as unknown as string, { kind: 'platform' })).toThrow(/userId/);
    }
  });

  it('companyId vazio, em branco, null ou undefined no escopo company ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() =>
        adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: invalid as unknown as string }),
      ).toThrow(/companyId/);
    }
  });
});

// ── M1-F S7-C — companyFilterId (3º parâmetro opcional de .list()) ─────────

describe('adminInviteQueryKeys — companyFilterId (S7-C)', () => {
  it('omitido: key idêntica à de antes do S7-C (compatibilidade total)', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'platform' })).toEqual([
      'admin-invites', 'user-1', 'platform',
    ]);
  });

  it('null: acrescenta o segmento estável "all"', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'platform' }, null)).toEqual([
      'admin-invites', 'user-1', 'platform', 'all',
    ]);
  });

  it('empresa específica: acrescenta o companyId', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'platform' }, 'company-a')).toEqual([
      'admin-invites', 'user-1', 'platform', 'company-a',
    ]);
  });

  it('escopo company: companyFilterId é ignorado, mesmo se informado', () => {
    expect(adminInviteQueryKeys.list('user-1', { kind: 'company', companyId: 'company-a' }, 'company-b')).toEqual([
      'admin-invites', 'user-1', 'company', 'company-a',
    ]);
  });

  it('omitido / null / empresa A / empresa B nunca colidem entre si', () => {
    const omitted = adminInviteQueryKeys.list('user-1', { kind: 'platform' });
    const global = adminInviteQueryKeys.list('user-1', { kind: 'platform' }, null);
    const companyA = adminInviteQueryKeys.list('user-1', { kind: 'platform' }, 'company-a');
    const companyB = adminInviteQueryKeys.list('user-1', { kind: 'platform' }, 'company-b');
    const all = [omitted, global, companyA, companyB];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]).not.toEqual(all[j]);
      }
    }
  });
});
