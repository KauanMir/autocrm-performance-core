// tests/leads/bulkImportRepository.test.ts — CRM-BULK-IMPORT-B2. Supabase
// mockado (rpc), sem rede real. Prova: preview/commit chamam bulk_import_leads
// com o payload em snake_case correto (contrato B1), erro vira
// BulkImportLeadsError com o código estável certo, resposta jsonb é
// traduzida para o shape camelCase da app.
import { describe, expect, it, vi } from 'vitest';
import {
  previewBulkImportLeads,
  commitBulkImportLeads,
  mapBulkImportLeadsError,
} from '@/lib/leads/bulkImportRepository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

const PAYLOAD = {
  rows: [{ rowNumber: 1, name: 'Cliente', phone: '11999990000', car: 'HB20', sellerId: 's1', temperature: 'hot', source: 'WhatsApp', paymentPreference: 'À vista' }],
  clientRequestId: 'req-1',
  filename: 'clientes.csv',
  carFallbackEnabled: true,
};

describe('previewBulkImportLeads', () => {
  it('chama bulk_import_leads com p_dry_run=true e as linhas em snake_case', async () => {
    mocks.rpc.mockResolvedValue({
      data: { total_rows: 1, valid_count: 1, duplicate_count: 0, error_count: 0, rows: [
        { row_number: 1, status: 'valid', code: null, normalized: { name: 'Cliente', phone: '11999990000', car: 'HB20', seller_id: 's1', temperature: 'hot', source: 'WhatsApp', payment_preference: 'À vista' } },
      ] },
      error: null,
    });
    const result = await previewBulkImportLeads(PAYLOAD);
    expect(mocks.rpc).toHaveBeenCalledWith('bulk_import_leads', {
      p_rows: [{ row_number: 1, name: 'Cliente', phone: '11999990000', car: 'HB20', source: 'WhatsApp', seller_id: 's1', temperature: 'hot', payment_preference: 'À vista' }],
      p_client_request_id: 'req-1',
      p_filename: 'clientes.csv',
      p_car_fallback_enabled: true,
      p_dry_run: true,
      p_company_id: undefined,
    });
    expect(result).toEqual({
      totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0,
      rows: [{ rowNumber: 1, status: 'valid', code: null, normalized: { name: 'Cliente', phone: '11999990000', car: 'HB20', sellerId: 's1', temperature: 'hot', source: 'WhatsApp', paymentPreference: 'À vista' } }],
    });
  });

  it('Manager/Seller: nunca envia p_company_id, mesmo se companyId vier no payload', async () => {
    mocks.rpc.mockResolvedValue({ data: { total_rows: 0, valid_count: 0, duplicate_count: 0, error_count: 0, rows: [] }, error: null });
    await previewBulkImportLeads({ ...PAYLOAD, rows: [] });
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBeUndefined();
  });

  it('Super Admin: envia p_company_id explícito quando presente no payload', async () => {
    mocks.rpc.mockResolvedValue({ data: { total_rows: 0, valid_count: 0, duplicate_count: 0, error_count: 0, rows: [] }, error: null });
    await previewBulkImportLeads({ ...PAYLOAD, rows: [], companyId: 'company-a' });
    expect(mocks.rpc.mock.calls[0][1].p_company_id).toBe('company-a');
  });

  it('erro do backend vira BulkImportLeadsError com o código mapeado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'company_read_only' } });
    await expect(previewBulkImportLeads(PAYLOAD)).rejects.toMatchObject({ code: 'bulk_import_company_read_only' });
  });

  it('mensagem desconhecida nunca é adivinhada como outro código — sempre generic_error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'algo_nunca_visto' } });
    await expect(previewBulkImportLeads(PAYLOAD)).rejects.toMatchObject({ code: 'bulk_import_generic_error' });
  });
});

describe('commitBulkImportLeads', () => {
  it('chama bulk_import_leads com p_dry_run=false e traduz a resposta de commit', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        batch_id: 'batch-1', status: 'completed', total_rows: 1, imported_count: 1, duplicate_count: 0, error_count: 0,
        rows: [{ row_number: 1, status: 'imported', code: null, lead_id: 'lead-1' }],
      },
      error: null,
    });
    const result = await commitBulkImportLeads(PAYLOAD);
    expect(mocks.rpc.mock.calls[0][1].p_dry_run).toBe(false);
    expect(result).toEqual({
      batchId: 'batch-1', status: 'completed', totalRows: 1, importedCount: 1, duplicateCount: 0, errorCount: 0,
      rows: [{ rowNumber: 1, status: 'imported', code: null, leadId: 'lead-1' }],
    });
  });

  it('linha duplicada/erro no commit nunca tem leadId', async () => {
    mocks.rpc.mockResolvedValue({
      data: { batch_id: 'batch-1', status: 'partial', total_rows: 1, imported_count: 0, duplicate_count: 1, error_count: 0,
        rows: [{ row_number: 1, status: 'duplicate', code: 'duplicate_phone' }] },
      error: null,
    });
    const result = await commitBulkImportLeads(PAYLOAD);
    expect(result.rows[0].leadId).toBeNull();
  });
});

describe('mapBulkImportLeadsError', () => {
  it.each([
    ['forbidden', 'bulk_import_forbidden'],
    ['company_required', 'bulk_import_company_required'],
    ['company_not_found', 'bulk_import_company_not_found'],
    ['company_read_only', 'bulk_import_company_read_only'],
    ['initial_stage_missing', 'bulk_import_initial_stage_missing'],
    ['bulk_import_limit_exceeded', 'bulk_import_limit_exceeded'],
  ])('mapeia "%s" para %s', (message, code) => {
    expect(mapBulkImportLeadsError({ message }).code).toBe(code);
  });

  it('sem mensagem: generic_error', () => {
    expect(mapBulkImportLeadsError({}).code).toBe('bulk_import_generic_error');
  });
});
