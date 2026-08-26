// tests/leads/BulkImportLeadsWizard.test.tsx — CRM-BULK-IMPORT-B2.
// Integração real do componente (parsing real via Papa Parse, hooks reais
// de mutation/query) com apenas os limites externos mockados: os hooks de
// Sellers (dados) e o repository de bulk_import_leads (rede). Prova o fluxo
// inteiro Arquivo -> Colunas -> Conferir -> Resultado sem crash, e que o
// resultado exibido vem SEMPRE da resposta do commit (nunca do preview).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  previewBulkImportLeads: vi.fn(),
  commitBulkImportLeads: vi.fn(),
}));

vi.mock('@/lib/leads/bulkImportRepository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/leads/bulkImportRepository')>('@/lib/leads/bulkImportRepository');
  return { ...actual, previewBulkImportLeads: m.previewBulkImportLeads, commitBulkImportLeads: m.commitBulkImportLeads };
});

vi.mock('@/lib/hooks/useCurrentCompanyAssignableSellers', () => ({
  useCurrentCompanyAssignableSellers: () => ({
    assignableSellers: [{ seller_id: 's1', name: 'João Silva' }],
    sellersById: {}, isLoading: false, isError: false,
  }),
}));
vi.mock('@/lib/hooks/usePlatformSellers', () => ({
  usePlatformSellers: () => ({ sellers: [], isLoading: false, isError: false }),
}));

import { BulkImportLeadsWizard } from '@/components/leads/BulkImportLeadsWizard';
import { BulkImportLeadsError } from '@/lib/leads/bulkImportRepository';

function renderWizard(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BulkImportLeadsWizard companyId="company-a" isSuperAdmin={false} userId="user-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

function csvFile(content: string): File {
  return new File([content], 'clientes.csv', { type: 'text/csv' });
}

beforeEach(() => {
  m.previewBulkImportLeads.mockReset();
  m.commitBulkImportLeads.mockReset();
});

describe('BulkImportLeadsWizard — fluxo completo', () => {
  it('Arquivo -> Colunas -> Conferir -> Resultado, com auto-detect e commit bem-sucedido', async () => {
    m.previewBulkImportLeads.mockResolvedValue({
      totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0,
      rows: [{ rowNumber: 1, status: 'valid', code: null, normalized: { name: 'Cliente Um', phone: '11999999999', car: 'HB20', sellerId: null, temperature: null, source: null, paymentPreference: null } }],
    });
    m.commitBulkImportLeads.mockResolvedValue({
      batchId: 'batch-1', status: 'completed', totalRows: 1, importedCount: 1, duplicateCount: 0, errorCount: 0,
      rows: [{ rowNumber: 1, status: 'imported', code: null, leadId: 'lead-1' }],
    });

    renderWizard();

    // ── Etapa 1: Arquivo ──────────────────────────────────────────────
    const input = screen.getByTestId('bulk-import-file-input');
    fireEvent.change(input, { target: { files: [csvFile('Nome,Telefone,Veículo\nCliente Um,11999999999,HB20')] } });
    await screen.findByText('clientes.csv');
    fireEvent.click(screen.getByText('Avançar'));

    // ── Etapa 2: Colunas (auto-detect já resolveu Nome/Telefone/Veículo) ─
    await screen.findByText('Colunas');
    expect(screen.getByTestId('bulk-import-mapping-name')).toHaveValue('Nome');
    expect(screen.getByTestId('bulk-import-mapping-phone')).toHaveValue('Telefone');
    expect(screen.getByTestId('bulk-import-mapping-car')).toHaveValue('Veículo');
    fireEvent.click(screen.getByText('Avançar para Conferir'));

    // ── Etapa 3: Conferir (dry-run) ──────────────────────────────────
    await waitFor(() => expect(m.previewBulkImportLeads).toHaveBeenCalledTimes(1));
    await screen.findByTestId('bulk-import-preview-table');
    expect(screen.getByText('Cliente Um')).toBeInTheDocument();
    const confirmSpan = await screen.findByTestId('bulk-import-confirm');
    expect(confirmSpan).toHaveTextContent('Importar 1 clientes');
    fireEvent.click(confirmSpan.querySelector('button')!);

    // ── Etapa 4: Resultado — SEMPRE a resposta do commit, nunca o preview ─
    await waitFor(() => expect(m.commitBulkImportLeads).toHaveBeenCalledTimes(1));
    const resultBlock = await screen.findByTestId('bulk-import-result');
    expect(resultBlock).toHaveTextContent('Importação concluída');
    expect(resultBlock).toHaveTextContent('1'); // importados

    // client_request_id: MESMO valor no preview e no commit (mesma tentativa).
    const previewArg = m.previewBulkImportLeads.mock.calls[0][0];
    const commitArg = m.commitBulkImportLeads.mock.calls[0][0];
    expect(commitArg.clientRequestId).toBe(previewArg.clientRequestId);
    // Manager: nunca envia companyId à RPC.
    expect(previewArg.companyId).toBeUndefined();
    expect(commitArg.companyId).toBeUndefined();
  });

  it('arquivo .xlsx: mensagem honesta, nunca tenta converter', async () => {
    renderWizard();
    const input = screen.getByTestId('bulk-import-file-input');
    fireEvent.change(input, { target: { files: [new File(['a,b'], 'clientes.xlsx', { type: 'application/vnd.ms-excel' })] } });
    await screen.findByText('Nesta versão, importe um arquivo CSV.');
    expect(m.previewBulkImportLeads).not.toHaveBeenCalled();
  });

  it('veículo sem coluna e sem fallback: nao permite avançar para Conferir', async () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('bulk-import-file-input'), {
      target: { files: [csvFile('Nome,Telefone\nCliente Um,11999999999')] },
    });
    await screen.findByText('clientes.csv');
    fireEvent.click(screen.getByText('Avançar'));
    await screen.findByText('Colunas');
    fireEvent.click(screen.getByText('Avançar para Conferir'));
    // Sem car mapeado e sem fallback: goToPreview nunca chama o backend.
    expect(m.previewBulkImportLeads).not.toHaveBeenCalled();
    expect(screen.getByText(/Mapeie uma coluna para Veículo/)).toBeInTheDocument();
  });

  it('resultado failed nunca é confundido com sucesso', async () => {
    m.previewBulkImportLeads.mockResolvedValue({
      totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0,
      rows: [{ rowNumber: 1, status: 'valid', code: null, normalized: { name: 'X', phone: '119', car: 'Y', sellerId: null, temperature: null, source: null, paymentPreference: null } }],
    });
    m.commitBulkImportLeads.mockRejectedValue(new BulkImportLeadsError('bulk_import_forbidden'));

    renderWizard();
    fireEvent.change(screen.getByTestId('bulk-import-file-input'), {
      target: { files: [csvFile('Nome,Telefone,Veículo\nX,119,Y')] },
    });
    await screen.findByText('clientes.csv');
    fireEvent.click(screen.getByText('Avançar'));
    await screen.findByText('Colunas');
    fireEvent.click(screen.getByText('Avançar para Conferir'));
    const confirmSpan = await screen.findByTestId('bulk-import-confirm');
    fireEvent.click(confirmSpan.querySelector('button')!);
    const failed = await screen.findByTestId('bulk-import-result-failed');
    expect(failed).toBeInTheDocument();
  });
});
