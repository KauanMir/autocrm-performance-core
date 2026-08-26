// tests/leads/bulkImportMapping.test.ts — CRM-BULK-IMPORT-B2.
import { describe, expect, it } from 'vitest';
import {
  autoDetectMapping,
  detectUnsupportedHeaders,
  availableColumnsForField,
  isMappingComplete,
  hasCarSource,
  normalizeTemperatureValue,
  matchSellerByName,
  distinctSellerValues,
  buildBulkImportRows,
  buildRejectedCsv,
  CAR_FALLBACK_VALUE,
  type FieldMapping,
} from '@/lib/leads/bulkImportMapping';
import type { ParsedCsv } from '@/lib/leads/csvImportParsing';

describe('autoDetectMapping', () => {
  it('detecta os aliases pt-BR conhecidos', () => {
    const mapping = autoDetectMapping(['Nome', 'Telefone', 'Veículo', 'Origem', 'Vendedor', 'Temperatura', 'Forma de pagamento']);
    expect(mapping).toEqual({
      name: 'Nome', phone: 'Telefone', car: 'Veículo', source: 'Origem',
      seller: 'Vendedor', temperature: 'Temperatura', paymentPreference: 'Forma de pagamento',
    });
  });

  it('nunca atribui a mesma coluna a dois campos', () => {
    // "nome" bate com o alias de name; nenhuma outra coluna deveria roubar
    // essa mesma coluna para outro campo.
    const mapping = autoDetectMapping(['nome']);
    expect(Object.values(mapping).filter(Boolean)).toEqual(['nome']);
  });

  it('colunas sem alias conhecido ficam sem mapeamento automático', () => {
    const mapping = autoDetectMapping(['coluna-x', 'coluna-y']);
    expect(mapping).toEqual({});
  });
});

describe('detectUnsupportedHeaders', () => {
  it('detecta email/observação/notas/comentário como não suportados', () => {
    const headers = ['Nome', 'Telefone', 'Email', 'Observação', 'Notas', 'Comentário'];
    expect(detectUnsupportedHeaders(headers, {})).toEqual(['Email', 'Observação', 'Notas', 'Comentário']);
  });

  it('coluna não suportada mapeada manualmente para um campo real deixa de ser "não suportada"', () => {
    const headers = ['Nome', 'Notas'];
    const mapping: FieldMapping = { source: 'Notas' };
    expect(detectUnsupportedHeaders(headers, mapping)).toEqual([]);
  });
});

describe('availableColumnsForField (colisão de mapeamento)', () => {
  it('exclui coluna já usada por OUTRO campo', () => {
    const headers = ['A', 'B'];
    const mapping: FieldMapping = { name: 'A' };
    expect(availableColumnsForField('phone', headers, mapping)).toEqual(['B']);
  });

  it('sempre inclui a própria coluna já escolhida pelo campo', () => {
    const headers = ['A', 'B'];
    const mapping: FieldMapping = { name: 'A' };
    expect(availableColumnsForField('name', headers, mapping)).toEqual(['A', 'B']);
  });
});

describe('isMappingComplete / hasCarSource', () => {
  it('exige nome e telefone mapeados', () => {
    expect(isMappingComplete({})).toBe(false);
    expect(isMappingComplete({ name: 'A' })).toBe(false);
    expect(isMappingComplete({ name: 'A', phone: 'B' })).toBe(true);
  });

  it('veículo: coluna OU fallback, nunca nenhum dos dois', () => {
    expect(hasCarSource({}, false)).toBe(false);
    expect(hasCarSource({}, true)).toBe(true);
    expect(hasCarSource({ car: 'Veículo' }, false)).toBe(true);
  });
});

describe('normalizeTemperatureValue', () => {
  it('traduz aliases pt-BR para o enum esperado pelo servidor', () => {
    expect(normalizeTemperatureValue('quente')).toBe('hot');
    expect(normalizeTemperatureValue('Morno')).toBe('warm');
    expect(normalizeTemperatureValue('FRIO')).toBe('cold');
  });
  it('valor já no enum passa direto', () => {
    expect(normalizeTemperatureValue('hot')).toBe('hot');
  });
  it('valor desconhecido segue como está (servidor decide o aviso, nunca erro aqui)', () => {
    expect(normalizeTemperatureValue('morninho')).toBe('morninho');
  });
  it('vazio vira null', () => {
    expect(normalizeTemperatureValue('')).toBeNull();
    expect(normalizeTemperatureValue(undefined)).toBeNull();
  });
});

describe('matchSellerByName', () => {
  const sellers = [
    { id: 's1', name: 'João Silva' },
    { id: 's2', name: 'joão silva' },
    { id: 's3', name: 'Maria' },
  ];
  it('vazio -> empty', () => {
    expect(matchSellerByName('', sellers)).toEqual({ kind: 'empty' });
  });
  it('match único case-insensitive', () => {
    expect(matchSellerByName('maria', sellers)).toEqual({ kind: 'unique', sellerId: 's3' });
  });
  it('sem match nenhum -> unmatched', () => {
    expect(matchSellerByName('Carlos', sellers)).toEqual({ kind: 'unmatched' });
  });
  it('múltiplos candidatos -> ambiguous, nunca escolhido automaticamente', () => {
    const result = matchSellerByName('João Silva', sellers);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });
});

describe('distinctSellerValues', () => {
  it('retorna valores distintos, ordem de primeira aparição, ignora vazios', () => {
    const rows = [{ v: 'João' }, { v: 'Maria' }, { v: 'João' }, { v: '' }, { v: 'Maria' }];
    expect(distinctSellerValues(rows, 'v')).toEqual(['João', 'Maria']);
  });
  it('sem coluna de vendedor mapeada: array vazio', () => {
    expect(distinctSellerValues([{ v: 'João' }], undefined)).toEqual([]);
  });
});

describe('buildBulkImportRows', () => {
  const parsed: ParsedCsv = {
    headers: ['Nome', 'Telefone', 'Veículo', 'Vendedor'],
    rows: [
      { Nome: ' Cliente A ', Telefone: '11999999999', Veículo: 'HB20', Vendedor: 'João' },
      { Nome: 'Cliente B', Telefone: '11988888888', Veículo: '', Vendedor: '' },
    ],
  };
  const mapping: FieldMapping = { name: 'Nome', phone: 'Telefone', car: 'Veículo', seller: 'Vendedor' };

  it('rowNumber é 1-based e estável, trima nome/telefone', () => {
    const rows = buildBulkImportRows(parsed, mapping, false, {});
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[0].name).toBe('Cliente A');
    expect(rows[1].rowNumber).toBe(2);
  });

  it('aplica fallback de veículo só quando habilitado, nunca silenciosamente', () => {
    const withoutFallback = buildBulkImportRows(parsed, mapping, false, {});
    expect(withoutFallback[1].car).toBeNull();

    const withFallback = buildBulkImportRows(parsed, mapping, true, {});
    expect(withFallback[1].car).toBe(CAR_FALLBACK_VALUE);
    // Linha com veículo preenchido nunca é sobrescrita pelo fallback.
    expect(withFallback[0].car).toBe('HB20');
  });

  it('resolve sellerId a partir da resolução explícita; célula vazia sempre null, nunca depende da resolução', () => {
    const rows = buildBulkImportRows(parsed, mapping, false, { João: 's1' });
    expect(rows[0].sellerId).toBe('s1');
    expect(rows[1].sellerId).toBeNull();
  });

  it('vendedor não resolvido ainda (undefined na resolução) vira null no payload (nunca o texto bruto)', () => {
    const rows = buildBulkImportRows(parsed, mapping, false, {});
    expect(rows[0].sellerId).toBeNull();
  });
});

describe('buildRejectedCsv', () => {
  const parsed: ParsedCsv = {
    headers: ['Nome', 'Telefone'],
    rows: [
      { Nome: 'Importado', Telefone: '11999999999' },
      { Nome: 'Duplicado', Telefone: '11988888888' },
      { Nome: 'ComErro', Telefone: '' },
    ],
  };

  it('inclui duplicates e errors, exclui imported', () => {
    const csv = buildRejectedCsv(parsed, [
      { rowNumber: 1, status: 'imported', code: null, leadId: 'lead-1' },
      { rowNumber: 2, status: 'duplicate', code: 'duplicate_phone', leadId: null },
      { rowNumber: 3, status: 'error', code: 'phone_required', leadId: null },
    ] as any);
    expect(csv).not.toContain('Importado');
    expect(csv).toContain('Duplicado');
    expect(csv).toContain('ComErro');
    expect(csv).toContain('Telefone já cadastrado');
    expect(csv).toContain('Telefone obrigatório');
  });

  it('funciona com resposta de PREVIEW (valid/duplicate/error) também', () => {
    const csv = buildRejectedCsv(parsed, [
      { rowNumber: 1, status: 'valid', code: null, normalized: {} as any },
      { rowNumber: 2, status: 'duplicate', code: 'duplicate_phone', normalized: {} as any },
      { rowNumber: 3, status: 'error', code: 'phone_required', normalized: {} as any },
    ] as any);
    expect(csv).not.toContain('Importado');
    expect(csv).toContain('Duplicado');
    expect(csv).toContain('ComErro');
  });

  it('preserva os headers originais e escapa vírgulas/aspas corretamente (via Papa.unparse)', () => {
    const withComma: ParsedCsv = {
      headers: ['Nome', 'Telefone'],
      rows: [{ Nome: 'Silva, João "Jota"', Telefone: '' }],
    };
    const csv = buildRejectedCsv(withComma, [{ rowNumber: 1, status: 'error', code: 'phone_required', leadId: null }] as any);
    expect(csv).toContain('"Silva, João ""Jota"""');
  });
});
