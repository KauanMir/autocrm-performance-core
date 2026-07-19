// Testes de adaptLocalStageNames (M1-D, commit 5).
import { describe, expect, it } from 'vitest';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

describe('adaptLocalStageNames', () => {
  it('preserva exatamente a ordem recebida (sortOrder = índice)', () => {
    const shuffled = ['Fechamento', 'Novo', 'Em negociação'];
    const stages = adaptLocalStageNames(shuffled);
    expect(stages.map((s) => s.name)).toEqual(shuffled);
    expect(stages.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });

  it('não modifica o array original', () => {
    const input = [...LOCAL_NAMES];
    adaptLocalStageNames(input);
    expect(input).toEqual(LOCAL_NAMES);
  });

  it('mapeia os cinco codes oficiais corretamente', () => {
    const stages = adaptLocalStageNames(LOCAL_NAMES);
    expect(stages.map((s) => s.code)).toEqual([
      'new', 'qualified', 'visit_scheduled', 'negotiation', 'closing',
    ]);
  });

  it('Fechamento é terminal', () => {
    const stages = adaptLocalStageNames(LOCAL_NAMES);
    expect(stages.find((s) => s.name === 'Fechamento')?.isTerminal).toBe(true);
  });

  it('os outros quatro stages não são terminais', () => {
    const stages = adaptLocalStageNames(LOCAL_NAMES);
    const nonTerminal = stages.filter((s) => s.name !== 'Fechamento');
    expect(nonTerminal).toHaveLength(4);
    expect(nonTerminal.every((s) => s.isTerminal === false)).toBe(true);
  });

  it('IDs locais são determinísticos e claramente locais', () => {
    const a = adaptLocalStageNames(LOCAL_NAMES);
    const b = adaptLocalStageNames(LOCAL_NAMES);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a.every((s) => s.id.startsWith('local-'))).toBe(true);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });

  it('nome desconhecido é preservado com code/id sintéticos determinísticos', () => {
    const stages = adaptLocalStageNames(['Novo', 'Pós-venda']);
    const unknown = stages[1];
    expect(unknown.name).toBe('Pós-venda');
    expect(unknown.code.startsWith('local_')).toBe(true);
    expect(unknown.isTerminal).toBe(false);
    const again = adaptLocalStageNames(['Novo', 'Pós-venda'])[1];
    expect(again.code).toBe(unknown.code);
    expect(again.id).toBe(unknown.id);
  });

  it('array vazio retorna array vazio', () => {
    expect(adaptLocalStageNames([])).toEqual([]);
  });
});
