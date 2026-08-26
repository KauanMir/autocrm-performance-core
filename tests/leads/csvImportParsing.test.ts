// tests/leads/csvImportParsing.test.ts — CRM-BULK-IMPORT-B2.
import { describe, expect, it } from 'vitest';
import {
  parseCsvFile,
  validateCsvFileBeforeParse,
  CsvParseError,
  BULK_IMPORT_MAX_COLUMNS,
} from '@/lib/leads/csvImportParsing';

function csvFile(content: string, name = 'clientes.csv', type = 'text/csv'): File {
  return new File([content], name, { type });
}

describe('validateCsvFileBeforeParse', () => {
  it('rejeita extensão diferente de .csv', () => {
    expect(() => validateCsvFileBeforeParse(csvFile('a,b\n1,2', 'clientes.xlsx'))).toThrow(CsvParseError);
    try {
      validateCsvFileBeforeParse(csvFile('a,b\n1,2', 'clientes.xlsx'));
    } catch (err) {
      expect((err as CsvParseError).code).toBe('invalid_extension');
    }
  });

  it('rejeita arquivo vazio (0 bytes)', () => {
    expect(() => validateCsvFileBeforeParse(csvFile(''))).toThrow(CsvParseError);
  });

  it('rejeita arquivo maior que 2MB', () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.csv', { type: 'text/csv' });
    try {
      validateCsvFileBeforeParse(big);
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect((err as CsvParseError).code).toBe('too_large');
    }
  });

  it('aceita .csv dentro do limite', () => {
    expect(() => validateCsvFileBeforeParse(csvFile('nome,telefone\nJoão,11999999999'))).not.toThrow();
  });
});

describe('parseCsvFile', () => {
  it('parseia CSV válido com header e linhas', async () => {
    const result = await parseCsvFile(csvFile('nome,telefone\nJoão,11999999999\nMaria,11988888888'));
    expect(result.headers).toEqual(['nome', 'telefone']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ nome: 'João', telefone: '11999999999' });
  });

  it('respeita aspas e vírgulas dentro de célula', async () => {
    const result = await parseCsvFile(csvFile('nome,observacao\n"Silva, João","Cliente, disse ""ligar depois"""'));
    expect(result.rows[0].nome).toBe('Silva, João');
    expect(result.rows[0].observacao).toBe('Cliente, disse "ligar depois"');
  });

  it('ignora linhas em branco', async () => {
    const result = await parseCsvFile(csvFile('nome,telefone\nJoão,11999999999\n\n\nMaria,11988888888\n'));
    expect(result.rows).toHaveLength(2);
  });

  it('trima espaços do cabeçalho', async () => {
    const result = await parseCsvFile(csvFile(' nome , telefone \nJoão,11999999999'));
    expect(result.headers).toEqual(['nome', 'telefone']);
  });

  it('rejeita arquivo só com cabeçalho, sem linha de dados', async () => {
    await expect(parseCsvFile(csvFile('nome,telefone'))).rejects.toMatchObject({ code: 'no_data_rows' });
  });

  it('rejeita mais de 2000 linhas', async () => {
    const lines = ['nome,telefone'];
    for (let i = 0; i < 2001; i++) lines.push(`Cliente ${i},1199999${String(i).padStart(4, '0')}`);
    await expect(parseCsvFile(csvFile(lines.join('\n')))).rejects.toMatchObject({ code: 'too_many_rows' });
  });

  it('rejeita mais de 15 colunas', async () => {
    const headers = Array.from({ length: BULK_IMPORT_MAX_COLUMNS + 1 }, (_, i) => `col${i}`);
    const values = headers.map((_, i) => String(i));
    await expect(parseCsvFile(csvFile(`${headers.join(',')}\n${values.join(',')}`))).rejects.toMatchObject({ code: 'too_many_columns' });
  });
});
