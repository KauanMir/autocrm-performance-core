// Testes do adapter de pipeline_stages (M1-D, commit 4).
// Fixtures tipadas como PipelineStageRow — sem rede, sem mock de Supabase,
// sem snapshots.
import { describe, expect, it } from 'vitest';
import type { PipelineStageRow } from '@/lib/supabase/types';
import {
  adaptPipelineStageRows,
  EXPECTED_STAGE_NAMES,
  type PipelineStage,
} from '@/lib/pipeline/adapter';

function row(overrides: Partial<PipelineStageRow> & { code: string; name: string; sort_order: number }): PipelineStageRow {
  return {
    id: `id-${overrides.code}`,
    company_id: 'company-1',
    is_terminal: false,
    created_at: '2026-07-18T00:00:00Z',
    updated_at: '2026-07-18T00:00:00Z',
    ...overrides,
  };
}

// As 5 rows oficiais, deliberadamente fora de ordem para os testes de sort.
function officialRows(): PipelineStageRow[] {
  return [
    row({ code: 'closing',         name: 'Fechamento',      sort_order: 4, is_terminal: true }),
    row({ code: 'new',             name: 'Novo',            sort_order: 0 }),
    row({ code: 'negotiation',     name: 'Em negociação',   sort_order: 3 }),
    row({ code: 'qualified',       name: 'Qualificado',     sort_order: 1 }),
    row({ code: 'visit_scheduled', name: 'Visita agendada', sort_order: 2 }),
  ];
}

function expectOk(result: ReturnType<typeof adaptPipelineStageRows>) {
  if (!result.ok) throw new Error(`esperava ok, veio mismatch: ${JSON.stringify(result)}`);
  return result;
}

function expectMismatch(result: ReturnType<typeof adaptPipelineStageRows>) {
  if (result.ok) throw new Error('esperava name-mismatch, veio ok');
  return result;
}

describe('adaptPipelineStageRows — mapeamento e ordenação', () => {
  it('mapeia snake_case → camelCase', () => {
    const { stages } = expectOk(adaptPipelineStageRows(officialRows()));
    const novo = stages[0];
    expect(novo).toEqual<PipelineStage>({
      id: 'id-new',
      code: 'new',
      name: 'Novo',
      sortOrder: 0,
      isTerminal: false,
    });
    expect(novo).not.toHaveProperty('sort_order');
    expect(novo).not.toHaveProperty('is_terminal');
    expect(novo).not.toHaveProperty('company_id');
  });

  it('ordena por sort_order crescente', () => {
    const { stages } = expectOk(adaptPipelineStageRows(officialRows()));
    expect(stages.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(stages.map((s) => s.code)).toEqual([
      'new', 'qualified', 'visit_scheduled', 'negotiation', 'closing',
    ]);
  });

  it('não muta o array original', () => {
    const input = officialRows();
    const before = input.map((r) => r.code);
    adaptPipelineStageRows(input);
    expect(input.map((r) => r.code)).toEqual(before);
  });

  it('mapeia is_terminal corretamente', () => {
    const { stages, byCode } = expectOk(adaptPipelineStageRows(officialRows()));
    expect(byCode['closing'].isTerminal).toBe(true);
    expect(stages.filter((s) => s.isTerminal).map((s) => s.code)).toEqual(['closing']);
  });
});

describe('adaptPipelineStageRows — índices', () => {
  it('cria byId corretamente', () => {
    const { byId } = expectOk(adaptPipelineStageRows(officialRows()));
    expect(Object.keys(byId)).toHaveLength(5);
    expect(byId['id-qualified'].name).toBe('Qualificado');
  });

  it('cria byCode corretamente', () => {
    const { byCode } = expectOk(adaptPipelineStageRows(officialRows()));
    expect(Object.keys(byCode)).toHaveLength(5);
    expect(byCode['visit_scheduled'].name).toBe('Visita agendada');
  });

  it('cria byName corretamente', () => {
    const { byName } = expectOk(adaptPipelineStageRows(officialRows()));
    expect(Object.keys(byName)).toHaveLength(5);
    expect(byName['Em negociação'].code).toBe('negotiation');
    expect(byName['Em negociação'].sortOrder).toBe(3);
  });
});

describe('adaptPipelineStageRows — compatibilidade dos 5 nomes', () => {
  it('cinco nomes exatos ⇒ ok', () => {
    const result = adaptPipelineStageRows(officialRows());
    expect(result.ok).toBe(true);
  });

  it('ordem de entrada diferente ⇒ ok (validação independe da ordem)', () => {
    const reversed = officialRows().reverse();
    const { stages } = expectOk(adaptPipelineStageRows(reversed));
    expect(stages.map((s) => s.code)[0]).toBe('new');
  });

  it('array vazio ⇒ ok com estruturas vazias (estado vazio válido)', () => {
    const result = expectOk(adaptPipelineStageRows([]));
    expect(result.stages).toEqual([]);
    expect(result.byId).toEqual({});
    expect(result.byCode).toEqual({});
    expect(result.byName).toEqual({});
  });

  it('estágio faltante ⇒ name-mismatch', () => {
    const rows = officialRows().filter((r) => r.name !== 'Qualificado');
    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.reason).toBe('name-mismatch');
    expect(m.missingNames).toEqual(['Qualificado']);
  });

  it('estágio extra ⇒ name-mismatch', () => {
    const rows = [...officialRows(), row({ code: 'extra', name: 'Pós-venda', sort_order: 5 })];
    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.unexpectedNames).toEqual(['Pós-venda']);
    expect(m.missingNames).toEqual([]);
  });

  it('nome renomeado ⇒ name-mismatch (faltante + inesperado)', () => {
    const rows = officialRows().map((r) =>
      r.name === 'Novo' ? { ...r, name: 'Entrada' } : r,
    );
    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.missingNames).toEqual(['Novo']);
    expect(m.unexpectedNames).toEqual(['Entrada']);
  });

  it('diferença de caixa ⇒ name-mismatch (comparação case-sensitive)', () => {
    const rows = officialRows().map((r) =>
      r.name === 'Novo' ? { ...r, name: 'novo' } : r,
    );
    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.missingNames).toEqual(['Novo']);
    expect(m.unexpectedNames).toEqual(['novo']);
  });

  it('nome duplicado ⇒ name-mismatch', () => {
    const rows = officialRows().map((r) =>
      r.name === 'Qualificado' ? { ...r, name: 'Novo' } : r,
    );
    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.duplicateNames).toEqual(['Novo']);
    expect(m.missingNames).toEqual(['Qualificado']);
  });

  it('listas missing/unexpected/duplicate corretas em cenário combinado', () => {
    // Remove 'Fechamento', renomeia 'Em negociação' → 'Negociando' e duplica 'Novo'.
    const rows = officialRows()
      .filter((r) => r.name !== 'Fechamento')
      .map((r) => (r.name === 'Em negociação' ? { ...r, name: 'Negociando' } : r));
    rows.push(row({ code: 'new_dup', name: 'Novo', sort_order: 9 }));

    const m = expectMismatch(adaptPipelineStageRows(rows));
    expect(m.expectedNames).toEqual([...EXPECTED_STAGE_NAMES]);
    expect(m.receivedNames).toHaveLength(5);
    expect([...m.missingNames].sort()).toEqual(['Em negociação', 'Fechamento']);
    expect(m.unexpectedNames).toEqual(['Negociando']);
    expect(m.duplicateNames).toEqual(['Novo']);
  });
});
