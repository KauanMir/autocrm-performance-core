// Testes de lib/deals/dealQueryKeys.ts (COMMERCIAL-REMOTE-DEALS-B2-A). Puro.
// Mesmo padrão de tests/tasks/taskQueryKeys.test.ts.
import { describe, expect, it } from 'vitest';
import { dealQueryKeys } from '@/lib/deals/dealQueryKeys';

describe('dealQueryKeys.root/active', () => {
  it('root e active produzem a mesma key (raiz já é a listagem — sem sub-key de status)', () => {
    expect(dealQueryKeys.active('company-a')).toEqual(dealQueryKeys.root('company-a'));
  });

  it('key estável para a mesma company', () => {
    expect(dealQueryKeys.root('company-a')).toEqual(dealQueryKeys.root('company-a'));
  });

  it('companies diferentes produzem keys distintas', () => {
    expect(dealQueryKeys.root('company-a')).not.toEqual(dealQueryKeys.root('company-b'));
  });

  it('shape exato: ["company", companyId, "deals"]', () => {
    expect(dealQueryKeys.root('company-a')).toEqual(['company', 'company-a', 'deals']);
  });

  it('companyId vazio ou não-string lança (bug de programação, falha alto)', () => {
    expect(() => dealQueryKeys.root('')).toThrow('dealQueryKeys: companyId é obrigatório e não pode ser vazio');
    expect(() => dealQueryKeys.root('   ')).toThrow();
    expect(() => dealQueryKeys.root(undefined as unknown as string)).toThrow();
  });

  it('nenhuma key carrega role/seller/user id', () => {
    const key = dealQueryKeys.root('company-a');
    expect(key).toHaveLength(3);
    expect(key).not.toContain('manager');
    expect(key).not.toContain('seller');
  });
});
