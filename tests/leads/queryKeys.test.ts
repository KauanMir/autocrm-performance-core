// Testes das query keys de leads remotos (M1-E, fase E2).
import { describe, expect, it } from 'vitest';
import { leadQueryKeys } from '@/lib/leads/queryKeys';

describe('leadQueryKeys — estrutura exata', () => {
  it('root: ["company", companyId, "leads"]', () => {
    expect(leadQueryKeys.root('company-a')).toEqual(['company', 'company-a', 'leads']);
  });

  it('active: igual à raiz (listagem padrão do design §14)', () => {
    expect(leadQueryKeys.active('company-a')).toEqual(['company', 'company-a', 'leads']);
  });

  it('archived: ["company", companyId, "leads", "archived"]', () => {
    expect(leadQueryKeys.archived('company-a')).toEqual([
      'company', 'company-a', 'leads', 'archived',
    ]);
  });

  it('detail: ["company", companyId, "leads", "detail", leadId]', () => {
    expect(leadQueryKeys.detail('company-a', 'lead-1')).toEqual([
      'company', 'company-a', 'leads', 'detail', 'lead-1',
    ]);
  });

  it('timeline: ["company", companyId, "leads", "timeline", leadId]', () => {
    expect(leadQueryKeys.timeline('company-a', 'lead-1')).toEqual([
      'company', 'company-a', 'leads', 'timeline', 'lead-1',
    ]);
  });

  it('keys contêm somente strings — nenhum objeto mutável, nenhum dado sensível', () => {
    const keys = [
      leadQueryKeys.root('company-a'),
      leadQueryKeys.active('company-a'),
      leadQueryKeys.archived('company-a'),
      leadQueryKeys.detail('company-a', 'lead-1'),
      leadQueryKeys.timeline('company-a', 'lead-1'),
    ];
    for (const key of keys) {
      expect(Array.isArray(key)).toBe(true);
      for (const part of key) expect(typeof part).toBe('string');
    }
  });
});

describe('leadQueryKeys — estabilidade e igualdade estrutural', () => {
  it('mesmos argumentos ⇒ igualdade estrutural, sem compartilhar o array', () => {
    expect(leadQueryKeys.root('x')).toEqual(leadQueryKeys.root('x'));
    expect(leadQueryKeys.archived('x')).toEqual(leadQueryKeys.archived('x'));
    expect(leadQueryKeys.detail('x', 'l1')).toEqual(leadQueryKeys.detail('x', 'l1'));
    expect(leadQueryKeys.timeline('x', 'l1')).toEqual(leadQueryKeys.timeline('x', 'l1'));
    // Arrays novos a cada chamada — mutação acidental de um retorno nunca
    // contamina chamadas futuras.
    expect(leadQueryKeys.root('x')).not.toBe(leadQueryKeys.root('x'));
  });
});

describe('leadQueryKeys — isolamento', () => {
  it('companies diferentes nunca colidem', () => {
    expect(leadQueryKeys.root('company-a')).not.toEqual(leadQueryKeys.root('company-b'));
    expect(leadQueryKeys.archived('company-a')).not.toEqual(leadQueryKeys.archived('company-b'));
    expect(leadQueryKeys.detail('company-a', 'lead-1'))
      .not.toEqual(leadQueryKeys.detail('company-b', 'lead-1'));
  });

  it('ativos e arquivados nunca compartilham a mesma key', () => {
    expect(leadQueryKeys.active('company-a')).not.toEqual(leadQueryKeys.archived('company-a'));
  });

  it('detalhe e timeline do mesmo lead não colidem', () => {
    expect(leadQueryKeys.detail('company-a', 'lead-1'))
      .not.toEqual(leadQueryKeys.timeline('company-a', 'lead-1'));
  });

  it('leads diferentes geram keys diferentes', () => {
    expect(leadQueryKeys.detail('company-a', 'lead-1'))
      .not.toEqual(leadQueryKeys.detail('company-a', 'lead-2'));
    expect(leadQueryKeys.timeline('company-a', 'lead-1'))
      .not.toEqual(leadQueryKeys.timeline('company-a', 'lead-2'));
  });
});

describe('leadQueryKeys — entradas inválidas', () => {
  it('companyId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => leadQueryKeys.root(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => leadQueryKeys.active(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => leadQueryKeys.archived(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => leadQueryKeys.detail(invalid as unknown as string, 'lead-1')).toThrow(/companyId/);
      expect(() => leadQueryKeys.timeline(invalid as unknown as string, 'lead-1')).toThrow(/companyId/);
    }
  });

  it('leadId vazio, em branco, null ou undefined ⇒ erro explícito em detail/timeline', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => leadQueryKeys.detail('company-a', invalid as unknown as string)).toThrow(/leadId/);
      expect(() => leadQueryKeys.timeline('company-a', invalid as unknown as string)).toThrow(/leadId/);
    }
  });
});

describe('leadQueryKeys — tipo readonly', () => {
  it('as keys são tuplas readonly em compile-time', () => {
    // Anotações explícitas: se a factory deixar de retornar tupla readonly,
    // este teste quebra na compilação.
    const root: readonly ['company', string, 'leads'] = leadQueryKeys.root('c');
    const archived: readonly ['company', string, 'leads', 'archived'] =
      leadQueryKeys.archived('c');
    const detail: readonly ['company', string, 'leads', 'detail', string] =
      leadQueryKeys.detail('c', 'l');
    const timeline: readonly ['company', string, 'leads', 'timeline', string] =
      leadQueryKeys.timeline('c', 'l');
    expect([root.length, archived.length, detail.length, timeline.length])
      .toEqual([3, 4, 5, 5]);
  });
});
