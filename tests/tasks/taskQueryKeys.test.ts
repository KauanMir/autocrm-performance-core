// Testes de lib/tasks/taskQueryKeys.ts (COMMERCIAL-REMOTE-B1-B2-A). Puro.
import { describe, expect, it } from 'vitest';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';

describe('taskQueryKeys.root/active', () => {
  it('root e active produzem a mesma key (raiz já é a listagem ativa/pending)', () => {
    expect(taskQueryKeys.active('company-a')).toEqual(taskQueryKeys.root('company-a'));
  });

  it('key estável para a mesma company', () => {
    expect(taskQueryKeys.root('company-a')).toEqual(taskQueryKeys.root('company-a'));
  });

  it('companies diferentes produzem keys distintas', () => {
    expect(taskQueryKeys.root('company-a')).not.toEqual(taskQueryKeys.root('company-b'));
  });

  it('shape exato: ["company", companyId, "tasks"]', () => {
    expect(taskQueryKeys.root('company-a')).toEqual(['company', 'company-a', 'tasks']);
  });

  it('companyId vazio ou não-string lança (bug de programação, falha alto)', () => {
    expect(() => taskQueryKeys.root('')).toThrow('taskQueryKeys: companyId é obrigatório e não pode ser vazio');
    expect(() => taskQueryKeys.root('   ')).toThrow();
    expect(() => taskQueryKeys.root(undefined as unknown as string)).toThrow();
  });

  it('nenhuma key carrega role/seller/user id', () => {
    const key = taskQueryKeys.root('company-a');
    expect(key).toHaveLength(3);
    expect(key).not.toContain('manager');
    expect(key).not.toContain('seller');
  });
});
