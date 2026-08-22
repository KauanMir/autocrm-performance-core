// Testes de lib/sales/salesQueryKeys.ts (COMMERCIAL-REMOTE-SALES-A2). Puro.
// Mesmo padrão de tests/deals/dealQueryKeys.test.ts.
import { describe, expect, it } from 'vitest';
import { salesQueryKeys } from '@/lib/sales/salesQueryKeys';

describe('salesQueryKeys.root/active', () => {
  it('root e active produzem a mesma key (raiz já é a listagem — sem sub-key)', () => {
    expect(salesQueryKeys.active('company-a')).toEqual(salesQueryKeys.root('company-a'));
  });

  it('key estável para a mesma company', () => {
    expect(salesQueryKeys.root('company-a')).toEqual(salesQueryKeys.root('company-a'));
  });

  it('companies diferentes produzem keys distintas', () => {
    expect(salesQueryKeys.root('company-a')).not.toEqual(salesQueryKeys.root('company-b'));
  });

  it('shape exato: ["company", companyId, "sales"]', () => {
    expect(salesQueryKeys.root('company-a')).toEqual(['company', 'company-a', 'sales']);
  });

  it('companyId vazio ou não-string lança (bug de programação, falha alto)', () => {
    expect(() => salesQueryKeys.root('')).toThrow('salesQueryKeys: companyId é obrigatório e não pode ser vazio');
    expect(() => salesQueryKeys.root('   ')).toThrow();
    expect(() => salesQueryKeys.root(undefined as unknown as string)).toThrow();
  });

  it('nenhuma key carrega role/seller/user id', () => {
    const key = salesQueryKeys.root('company-a');
    expect(key).toHaveLength(3);
    expect(key).not.toContain('manager');
    expect(key).not.toContain('seller');
  });
});
