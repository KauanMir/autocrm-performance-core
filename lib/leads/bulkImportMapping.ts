// lib/leads/bulkImportMapping.ts — mapeamento de colunas, auto-detect,
// campos não suportados, resolução de vendedor e geração do payload/CSV de
// rejeitadas para a importação em massa (CRM-BULK-IMPORT-B2). Tudo aqui é
// SUGESTÃO/UX — a autoridade de validação continua sendo bulk_import_leads
// (backend), nunca recalculada aqui como decisão final.
import Papa from 'papaparse';
import type { ParsedCsv } from '@/lib/leads/csvImportParsing';
import type { BulkImportRowInput, BulkImportCommitRow, BulkImportPreviewRow } from '@/lib/leads/bulkImportRepository';
import { bulkImportRowCodeMessage, bulkImportStatusLabel } from '@/lib/leads/bulkImportCopy';

export const CRM_FIELDS = ['name', 'phone', 'car', 'source', 'seller', 'temperature', 'paymentPreference'] as const;
export type BulkImportCrmField = (typeof CRM_FIELDS)[number];

export const CRM_FIELD_LABELS: Record<BulkImportCrmField, string> = {
  name: 'Nome',
  phone: 'Telefone',
  car: 'Veículo',
  source: 'Origem',
  seller: 'Vendedor',
  temperature: 'Temperatura',
  paymentPreference: 'Forma de pagamento',
};

export const REQUIRED_CRM_FIELDS: readonly BulkImportCrmField[] = ['name', 'phone'];

// Coluna do CSV mapeada para cada campo do CRM — string vazia/ausente =
// "Não mapear" (usuário sempre pode desmapear manualmente).
export type FieldMapping = Partial<Record<BulkImportCrmField, string>>;

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

const AUTO_DETECT_ALIASES: Record<BulkImportCrmField, string[]> = {
  name: ['nome', 'name', 'cliente'],
  phone: ['telefone', 'celular', 'whatsapp'],
  car: ['veiculo', 'carro', 'modelo'],
  source: ['origem', 'source'],
  seller: ['vendedor', 'consultor'],
  temperature: ['temperatura'],
  paymentPreference: ['pagamento', 'forma de pagamento', 'forma_de_pagamento'],
};

// Colunas que sabemos existir em planilhas comuns mas que o Lead de hoje
// não suporta — mostradas como "Não suportado nesta versão", nunca
// enviadas ao backend, nunca salvas em outro campo por engano (A1 §4/§11).
const UNSUPPORTED_ALIASES = ['email', 'observacao', 'observações', 'notas', 'comentario', 'comentarios'];

// Sugestão automática, nunca vinculante — cada campo do CRM recebe a
// PRIMEIRA coluna ainda não usada por outro campo cujo header normalizado
// bata com um alias conhecido. Usuário sempre pode corrigir depois.
export function autoDetectMapping(headers: readonly string[]): FieldMapping {
  const mapping: FieldMapping = {};
  const used = new Set<string>();
  for (const field of CRM_FIELDS) {
    const aliases = AUTO_DETECT_ALIASES[field];
    const match = headers.find((h) => !used.has(h) && aliases.includes(normalizeHeader(h)));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

// Colunas reconhecidas como "não suportadas nesta versão" — só as que
// NÃO foram explicitamente mapeadas para um campo real pelo usuário (um
// header chamado "notas" que o usuário decidiu mapear para Origem, por
// exemplo, deixa de ser mostrado como não suportado).
export function detectUnsupportedHeaders(headers: readonly string[], mapping: FieldMapping): string[] {
  const mappedHeaders = new Set(Object.values(mapping).filter((v): v is string => Boolean(v)));
  return headers.filter((h) => !mappedHeaders.has(h) && UNSUPPORTED_ALIASES.includes(normalizeHeader(h)));
}

// Colunas disponíveis para UM campo específico no <select> de mapping —
// exclui qualquer coluna já usada por OUTRO campo (nunca a mesma coluna CSV
// mapeada para dois campos incompatíveis ao mesmo tempo, B2 §16), mas
// sempre inclui a própria coluna já escolhida por este campo.
export function availableColumnsForField(
  field: BulkImportCrmField,
  headers: readonly string[],
  mapping: FieldMapping,
): string[] {
  const usedByOthers = new Set(
    CRM_FIELDS.filter((f) => f !== field)
      .map((f) => mapping[f])
      .filter((v): v is string => Boolean(v)),
  );
  return headers.filter((h) => !usedByOthers.has(h));
}

export function isMappingComplete(mapping: FieldMapping): boolean {
  return REQUIRED_CRM_FIELDS.every((f) => Boolean(mapping[f]));
}

// ── Veículo: coluna OU fallback explícito (nunca os dois faltando) ───────
export function hasCarSource(mapping: FieldMapping, carFallbackEnabled: boolean): boolean {
  return Boolean(mapping.car) || carFallbackEnabled;
}

export const CAR_FALLBACK_VALUE = 'Não informado';

function resolveCarValue(raw: string | undefined, carFallbackEnabled: boolean): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed !== '') return trimmed;
  return carFallbackEnabled ? CAR_FALLBACK_VALUE : null;
}

// ── Temperatura: aliases pt-BR normalizados ANTES do envio (o servidor só
//    reconhece hot/warm/cold — enviar o alias já traduzido evita um
//    invalid_temperature evitável; qualquer outro texto segue como está e
//    o servidor decide o aviso, nunca um erro). ──────────────────────────
const TEMPERATURE_ALIASES: Record<string, string> = {
  hot: 'hot', quente: 'hot',
  warm: 'warm', morno: 'warm',
  cold: 'cold', frio: 'cold',
};

export function normalizeTemperatureValue(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  return TEMPERATURE_ALIASES[normalizeHeader(trimmed)] ?? trimmed;
}

// ── Vendedor: match exato case-insensitive contra os Sellers ativos reais
//    da empresa (carregados via RPC já existente pelo chamador — nunca
//    inventados aqui). ────────────────────────────────────────────────────
export type SellerOption = { id: string; name: string };

export type SellerMatch =
  | { kind: 'empty' }
  | { kind: 'unmatched' }
  | { kind: 'unique'; sellerId: string }
  | { kind: 'ambiguous'; candidates: SellerOption[] };

export function matchSellerByName(rawValue: string | undefined, sellers: readonly SellerOption[]): SellerMatch {
  const trimmed = (rawValue ?? '').trim();
  if (trimmed === '') return { kind: 'empty' };
  const norm = normalizeHeader(trimmed);
  const candidates = sellers.filter((s) => normalizeHeader(s.name) === norm);
  if (candidates.length === 0) return { kind: 'unmatched' };
  if (candidates.length === 1) return { kind: 'unique', sellerId: candidates[0].id };
  return { kind: 'ambiguous', candidates };
}

// Valores DISTINTOS de vendedor presentes no CSV (para a UI resolver um
// por um, uma única vez por valor — nunca linha a linha) — ordem de
// primeira aparição, preservada para uma UX previsível.
export function distinctSellerValues(rows: readonly Record<string, string>[], sellerColumn: string | undefined): string[] {
  if (!sellerColumn) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of rows) {
    const raw = (row[sellerColumn] ?? '').trim();
    if (raw === '' || seen.has(raw)) continue;
    seen.add(raw);
    values.push(raw);
  }
  return values;
}

// Resolução final por valor textual: 'sem-vendedor' (explícito, sellerId
// null) ou o sellerId escolhido. Ambíguo/sem match: undefined = "usuário
// ainda não resolveu" — nunca escolhido automaticamente (B2 §18).
export type SellerResolution = Readonly<Record<string, string | null | undefined>>;

// ── Construção do payload final, uma linha por linha do CSV ─────────────
export function buildBulkImportRows(
  parsed: ParsedCsv,
  mapping: FieldMapping,
  carFallbackEnabled: boolean,
  sellerResolution: SellerResolution,
): BulkImportRowInput[] {
  return parsed.rows.map((row, index) => {
    const sellerRaw = mapping.seller ? (row[mapping.seller] ?? '').trim() : '';
    const resolvedSellerId = sellerRaw === '' ? null : (sellerResolution[sellerRaw] ?? null);
    return {
      rowNumber: index + 1,
      name: mapping.name ? (row[mapping.name] ?? '').trim() : '',
      phone: mapping.phone ? (row[mapping.phone] ?? '').trim() : '',
      car: resolveCarValue(mapping.car ? row[mapping.car] : undefined, carFallbackEnabled),
      source: mapping.source ? (row[mapping.source] ?? '').trim() || null : null,
      sellerId: resolvedSellerId,
      temperature: mapping.temperature ? normalizeTemperatureValue(row[mapping.temperature]) : null,
      paymentPreference: mapping.paymentPreference ? (row[mapping.paymentPreference] ?? '').trim() || null : null,
    };
  });
}

// ── CSV de rejeitadas (duplicadas + com erro — nunca as importadas) ─────
// Usa os dados ORIGINAIS preservados no browser (nunca o payload
// normalizado enviado ao backend) + duas colunas novas com o motivo,
// sempre em texto já traduzido (nunca o código cru). Papa.unparse cuida do
// escaping de vírgulas/aspas/quebras de linha — nunca um join manual.
export function buildRejectedCsv(
  parsed: ParsedCsv,
  resultRows: readonly (BulkImportCommitRow | BulkImportPreviewRow)[],
): string {
  const byRowNumber = new Map(resultRows.map((r) => [r.rowNumber, r]));
  const statusColumn = 'Status da importação';
  const reasonColumn = 'Motivo';

  const outRows: Record<string, string>[] = [];
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const result = byRowNumber.get(rowNumber);
    if (!result) return;
    const isImported = 'leadId' in result ? result.status === 'imported' : result.status === 'valid';
    if (isImported) return;
    outRows.push({
      ...row,
      [statusColumn]: bulkImportStatusLabel(result.status as any),
      [reasonColumn]: bulkImportRowCodeMessage(result.code),
    });
  });

  return Papa.unparse(outRows, { columns: [...parsed.headers, statusColumn, reasonColumn] });
}
