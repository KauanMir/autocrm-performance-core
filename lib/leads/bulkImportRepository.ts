// lib/leads/bulkImportRepository.ts — chamada da RPC bulk_import_leads
// (CRM-BULK-IMPORT-B1, já implementada e verificada no backend). Este
// arquivo NUNCA recria as regras do servidor como autoridade — apenas
// tipa o payload/resposta e chama a RPC. dry_run e commit usam a MESMA
// função exportada, só o parâmetro `dryRun` muda (mesmo contrato do A2/B1:
// preview e commit compartilham a identica classificação em lote).
//
// Contrato de fio: p_rows é um array JSON em snake_case
// (row_number/seller_id/payment_preference) — a RPC extrai via
// jsonb_array_elements/->> (CRM-BULK-IMPORT-B1), não via
// jsonb_to_recordset, então as chaves precisam bater exatamente com esses
// nomes. Nunca camelCase no wire, mesmo que os tipos de app/hook usem
// camelCase (tradução acontece só aqui, mesmo padrão de createRemoteLead).
import { supabase } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';

export type BulkImportRowInput = {
  rowNumber: number;
  name: string;
  phone: string;
  // null = coluna não mapeada/célula vazia — o servidor decide
  // car_required ou aplica o fallback conforme p_car_fallback_enabled.
  car: string | null;
  source?: string | null;
  sellerId?: string | null;
  // Texto (nunca o enum diretamente) — o servidor normaliza hot/warm/cold
  // e decide invalid_temperature; ver lib/leads/bulkImportMapping.ts.
  temperature?: string | null;
  paymentPreference?: string | null;
};

export type BulkImportRowStatus = 'valid' | 'duplicate' | 'error';
export type BulkImportCommitRowStatus = 'imported' | 'duplicate' | 'error';

export type BulkImportNormalizedRow = {
  name: string | null;
  phone: string | null;
  car: string | null;
  sellerId: string | null;
  temperature: string | null;
  source: string | null;
  paymentPreference: string | null;
};

export type BulkImportPreviewRow = {
  rowNumber: number;
  status: BulkImportRowStatus;
  code: string | null;
  normalized: BulkImportNormalizedRow;
};

export type BulkImportPreviewResponse = {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: BulkImportPreviewRow[];
};

export type BulkImportCommitRow = {
  rowNumber: number;
  status: BulkImportCommitRowStatus;
  code: string | null;
  leadId: string | null;
};

export type BulkImportCommitStatus = 'completed' | 'partial' | 'failed';

export type BulkImportCommitResponse = {
  batchId: string;
  status: BulkImportCommitStatus;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: BulkImportCommitRow[];
};

export type BulkImportLeadsPayload = {
  rows: BulkImportRowInput[];
  clientRequestId: string;
  filename: string;
  carFallbackEnabled: boolean;
  // Só enviado quando o ator é Super Admin contextual — Manager/Seller
  // nunca enviam company_id (o resolver do servidor ignora para eles,
  // mesmo padrão de createRemoteLead/remoteMutationRepository.ts).
  companyId?: string | null;
};

export type BulkImportLeadsErrorCode =
  | 'bulk_import_forbidden'
  | 'bulk_import_company_required'
  | 'bulk_import_company_not_found'
  | 'bulk_import_company_read_only'
  | 'bulk_import_initial_stage_missing'
  | 'bulk_import_limit_exceeded'
  | 'bulk_import_generic_error';

export interface BulkImportLeadsErrorDetail {
  code?: string;
  message?: string;
}

export class BulkImportLeadsError extends Error {
  readonly code: BulkImportLeadsErrorCode;
  readonly detail: BulkImportLeadsErrorDetail;

  constructor(code: BulkImportLeadsErrorCode, detail: BulkImportLeadsErrorDetail = {}) {
    super(code);
    this.name = 'BulkImportLeadsError';
    this.code = code;
    this.detail = detail;
  }
}

// Mapeamento EXAUSTIVO das mensagens estáveis que bulk_import_leads
// realmente lança (supabase/migrations/20260826100000_bulk_import_leads_b1.sql)
// — mensagem não reconhecida sempre vira bulk_import_generic_error, nunca
// adivinhada como outro código (mesmo padrão de mapRemoteLeadsMutationError).
const BACKEND_MESSAGE_CODES: Readonly<Record<string, BulkImportLeadsErrorCode>> = {
  forbidden: 'bulk_import_forbidden',
  company_required: 'bulk_import_company_required',
  company_not_found: 'bulk_import_company_not_found',
  company_read_only: 'bulk_import_company_read_only',
  initial_stage_missing: 'bulk_import_initial_stage_missing',
  bulk_import_limit_exceeded: 'bulk_import_limit_exceeded',
  bulk_import_generic_error: 'bulk_import_generic_error',
};

export function mapBulkImportLeadsError(error: { code?: unknown; message?: unknown }): BulkImportLeadsError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new BulkImportLeadsError(mappedCode ?? 'bulk_import_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
  });
}

function toWireRow(row: BulkImportRowInput): Record<string, unknown> {
  return {
    row_number: row.rowNumber,
    name: row.name,
    phone: row.phone,
    car: row.car,
    source: row.source ?? null,
    seller_id: row.sellerId ?? null,
    temperature: row.temperature ?? null,
    payment_preference: row.paymentPreference ?? null,
  };
}

function fromWirePreviewRow(raw: any): BulkImportPreviewRow {
  const normalized = raw.normalized ?? {};
  return {
    rowNumber: raw.row_number,
    status: raw.status,
    code: raw.code ?? null,
    normalized: {
      name: normalized.name ?? null,
      phone: normalized.phone ?? null,
      car: normalized.car ?? null,
      sellerId: normalized.seller_id ?? null,
      temperature: normalized.temperature ?? null,
      source: normalized.source ?? null,
      paymentPreference: normalized.payment_preference ?? null,
    },
  };
}

function fromWireCommitRow(raw: any): BulkImportCommitRow {
  return {
    rowNumber: raw.row_number,
    status: raw.status,
    code: raw.code ?? null,
    leadId: raw.lead_id ?? null,
  };
}

async function callBulkImportLeads(payload: BulkImportLeadsPayload, dryRun: boolean): Promise<Json> {
  const { data, error } = await supabase.rpc('bulk_import_leads', {
    p_rows: payload.rows.map(toWireRow) as unknown as Json,
    p_client_request_id: payload.clientRequestId,
    p_filename: payload.filename,
    p_car_fallback_enabled: payload.carFallbackEnabled,
    p_dry_run: dryRun,
    p_company_id: payload.companyId ?? undefined,
  });
  if (error) throw mapBulkImportLeadsError(error);
  if (!data) throw mapBulkImportLeadsError({ message: 'bulk_import_generic_error' });
  return data;
}

// dryRun=true: zero writes no servidor (RPC nunca chega perto de um
// INSERT — ver o guard `if p_dry_run then return ...` na migration).
export async function previewBulkImportLeads(payload: BulkImportLeadsPayload): Promise<BulkImportPreviewResponse> {
  const raw: any = await callBulkImportLeads(payload, true);
  return {
    totalRows: raw.total_rows,
    validCount: raw.valid_count,
    duplicateCount: raw.duplicate_count,
    errorCount: raw.error_count,
    rows: (raw.rows ?? []).map(fromWirePreviewRow),
  };
}

// dryRun=false: autoridade final. O servidor revalida tudo do zero (nunca
// confia nesta chamada ter sido precedida por um preview) — os números
// desta resposta são os únicos que a UI pode tratar como definitivos.
export async function commitBulkImportLeads(payload: BulkImportLeadsPayload): Promise<BulkImportCommitResponse> {
  const raw: any = await callBulkImportLeads(payload, false);
  return {
    batchId: raw.batch_id,
    status: raw.status,
    totalRows: raw.total_rows,
    importedCount: raw.imported_count,
    duplicateCount: raw.duplicate_count,
    errorCount: raw.error_count,
    rows: (raw.rows ?? []).map(fromWireCommitRow),
  };
}
