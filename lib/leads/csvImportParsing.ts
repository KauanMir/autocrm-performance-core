// lib/leads/csvImportParsing.ts — parsing de CSV 100% client-side (Papa
// Parse) para a importação em massa (CRM-BULK-IMPORT-B2). Nenhum upload de
// arquivo bruto: só o resultado já estruturado sai deste módulo. Backend
// mantém seu próprio limite de linhas (bulk_import_leads recusa >2000 com
// bulk_import_limit_exceeded) — os limites daqui são só UX: bloquear ANTES
// de qualquer chamada de rede quando já sabemos que o servidor recusaria.
import Papa from 'papaparse';

export const BULK_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BULK_IMPORT_MAX_ROWS = 2000;
export const BULK_IMPORT_MAX_COLUMNS = 15;

export type CsvParseErrorCode =
  | 'invalid_extension'
  | 'empty_file'
  | 'too_large'
  | 'no_data_rows'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'parse_failed';

export class CsvParseError extends Error {
  readonly code: CsvParseErrorCode;
  constructor(code: CsvParseErrorCode) {
    super(code);
    this.name = 'CsvParseError';
    this.code = code;
  }
}

export function csvParseErrorMessage(code: CsvParseErrorCode): string {
  switch (code) {
    case 'invalid_extension':
      return 'Nesta versão, importe um arquivo CSV.';
    case 'empty_file':
      return 'O arquivo está vazio.';
    case 'too_large':
      return 'O arquivo é maior que 2 MB.';
    case 'no_data_rows':
      return 'O arquivo tem apenas o cabeçalho, sem nenhuma linha de dados.';
    case 'too_many_rows':
      return `O arquivo tem mais de ${BULK_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas.`;
    case 'too_many_columns':
      return `O arquivo tem mais de ${BULK_IMPORT_MAX_COLUMNS} colunas.`;
    case 'parse_failed':
      return 'Não foi possível ler este arquivo.';
  }
}

// Checagem antes de sequer tentar o parse — nome/tamanho vêm do próprio
// File, sem ler o conteúdo ainda.
export function validateCsvFileBeforeParse(file: File): void {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.csv')) throw new CsvParseError('invalid_extension');
  if (file.size === 0) throw new CsvParseError('empty_file');
  if (file.size > BULK_IMPORT_MAX_FILE_BYTES) throw new CsvParseError('too_large');
}

export type ParsedCsv = {
  // Cabeçalhos na ordem original do arquivo — usados tanto no mapeamento
  // quanto para preservar a ordem de colunas no CSV de rejeitadas.
  headers: string[];
  // Cada linha é o objeto bruto {header: valor}, 1:1 com o CSV original —
  // preservado para gerar o CSV de rejeitadas depois do commit (nunca
  // reconstruído a partir do payload enviado ao backend).
  rows: Record<string, string>[];
};

// header:true + skipEmptyLines:true cobre aspas/vírgulas dentro de célula
// e linhas em branco automaticamente (comportamento padrão do Papa Parse);
// transformHeader normaliza espaços nas bordas do cabeçalho, nunca o
// conteúdo das células.
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        try {
          const headers = (results.meta.fields ?? []).filter((h) => h !== '');
          if (headers.length === 0) {
            reject(new CsvParseError('empty_file'));
            return;
          }
          if (headers.length > BULK_IMPORT_MAX_COLUMNS) {
            reject(new CsvParseError('too_many_columns'));
            return;
          }
          // Papa Parse ainda pode devolver uma linha "toda vazia" quando o
          // CSV termina com vírgulas soltas — filtrado aqui, nunca contado
          // como linha de dados real.
          const rows = (results.data ?? []).filter((row) =>
            Object.values(row).some((value) => (value ?? '').toString().trim() !== ''),
          );
          if (rows.length === 0) {
            reject(new CsvParseError('no_data_rows'));
            return;
          }
          if (rows.length > BULK_IMPORT_MAX_ROWS) {
            reject(new CsvParseError('too_many_rows'));
            return;
          }
          resolve({ headers, rows });
        } catch {
          reject(new CsvParseError('parse_failed'));
        }
      },
      error: () => reject(new CsvParseError('parse_failed')),
    });
  });
}
