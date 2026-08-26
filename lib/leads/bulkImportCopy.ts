// lib/leads/bulkImportCopy.ts — tradução PT-BR de códigos estáveis do
// bulk_import_leads (CRM-BULK-IMPORT-B1) para texto de UI. Nunca expõe
// mensagem SQL crua; código não reconhecido sempre cai num fallback
// sanitizado, nunca é adivinhado como outro código conhecido (mesmo
// princípio de lib/leads/errors.ts).
import type { BulkImportLeadsErrorCode } from '@/lib/leads/bulkImportRepository';

// Erros de LOTE (a RPC lança exceção antes de processar qualquer linha).
export function bulkImportBatchErrorMessage(code: BulkImportLeadsErrorCode): string {
  switch (code) {
    case 'bulk_import_forbidden':
      return 'Você não tem permissão para importar clientes nesta empresa.';
    case 'bulk_import_company_required':
      return 'Selecione uma empresa antes de importar.';
    case 'bulk_import_company_not_found':
      return 'Empresa não encontrada.';
    case 'bulk_import_company_read_only':
      return 'Esta empresa está em modo somente leitura.';
    case 'bulk_import_initial_stage_missing':
      return 'Esta empresa ainda não tem as etapas do funil configuradas.';
    case 'bulk_import_limit_exceeded':
      return 'O arquivo tem mais linhas do que o permitido nesta versão.';
    default:
      return 'Não foi possível processar a importação.';
  }
}

// Códigos de LINHA — aparecem em rows[].code, tanto no preview (status
// valid/duplicate/error) quanto no resultado do commit
// (imported/duplicate/error). `invalid_temperature` é o único que pode
// acompanhar uma linha 'valid'/'imported' (aviso, nunca bloqueia — B1 §16).
export function bulkImportRowCodeMessage(code: string | null): string {
  switch (code) {
    case null:
      return '';
    case 'name_required':
      return 'Nome obrigatório';
    case 'phone_required':
      return 'Telefone obrigatório';
    case 'car_required':
      return 'Veículo obrigatório';
    case 'seller_not_found':
      return 'Vendedor não encontrado';
    case 'duplicate_phone':
      return 'Telefone já cadastrado';
    case 'invalid_temperature':
      return 'Temperatura não reconhecida. O cliente será importado sem temperatura.';
    default:
      return 'Não foi possível validar esta linha.';
  }
}

export type BulkImportRowVisualStatus = 'valid' | 'duplicate' | 'error' | 'warning' | 'imported';

// Rótulo curto para a coluna "Status" da tabela de preview/resultado —
// nunca o código técnico cru como label principal (B2 §28).
export function bulkImportStatusLabel(status: BulkImportRowVisualStatus): string {
  switch (status) {
    case 'valid':
      return 'Válido';
    case 'imported':
      return 'Importado';
    case 'duplicate':
      return 'Duplicado';
    case 'error':
      return 'Erro';
    case 'warning':
      return 'Aviso';
  }
}
