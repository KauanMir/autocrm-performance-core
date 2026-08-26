// tests/hooks/useBulkImportLeads.test.tsx — CRM-BULK-IMPORT-B2. Repository
// mockado — prova que o hook só orquestra chamadas/invalidation, nunca
// recalcula regra de negócio, e que a invalidação de cache segue a árvore
// certa (RLS para Manager/Seller, platform para Super Admin) só quando
// algo foi realmente importado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBulkImportLeads, type UseBulkImportLeadsOptions } from '@/lib/hooks/useBulkImportLeads';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';

const mocks = vi.hoisted(() => ({
  previewBulkImportLeads: vi.fn(),
  commitBulkImportLeads: vi.fn(),
}));

vi.mock('@/lib/leads/bulkImportRepository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/leads/bulkImportRepository')>('@/lib/leads/bulkImportRepository');
  return {
    ...actual,
    previewBulkImportLeads: mocks.previewBulkImportLeads,
    commitBulkImportLeads: mocks.commitBulkImportLeads,
  };
});

const PAYLOAD = { rows: [], clientRequestId: 'req-1', filename: 'a.csv', carFallbackEnabled: false };

function setup(options: Partial<UseBulkImportLeadsOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (opts: UseBulkImportLeadsOptions) => useBulkImportLeads(opts),
    { wrapper, initialProps: { authorized: true, isSuperAdmin: false, companyId: 'company-a', ...options } },
  );
  return { queryClient, invalidateSpy, hook };
}

beforeEach(() => {
  mocks.previewBulkImportLeads.mockReset();
  mocks.commitBulkImportLeads.mockReset();
});

describe('useBulkImportLeads', () => {
  it('preview chama previewBulkImportLeads e nunca invalida cache', async () => {
    mocks.previewBulkImportLeads.mockResolvedValue({ totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0, rows: [] });
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.preview(PAYLOAD);
    expect(mocks.previewBulkImportLeads).toHaveBeenCalledWith(PAYLOAD);
    expect(result.validCount).toBe(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('não autorizado: preview/commit nunca chamam o repository', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.preview(PAYLOAD)).rejects.toThrow();
    await expect(hook.result.current.commit(PAYLOAD)).rejects.toThrow();
    expect(mocks.previewBulkImportLeads).not.toHaveBeenCalled();
    expect(mocks.commitBulkImportLeads).not.toHaveBeenCalled();
  });

  it('commit com importedCount>0 (Manager/Seller): invalida a RAIZ de leadQueryKeys da empresa', async () => {
    mocks.commitBulkImportLeads.mockResolvedValue({ batchId: 'b1', status: 'completed', totalRows: 1, importedCount: 1, duplicateCount: 0, errorCount: 0, rows: [] });
    const { hook, invalidateSpy } = setup({ isSuperAdmin: false, companyId: 'company-a' });
    await hook.result.current.commit(PAYLOAD);
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-a') }));
  });

  it('commit com importedCount>0 (Super Admin): invalida a raiz platform da empresa, nunca a árvore de Manager/Seller', async () => {
    mocks.commitBulkImportLeads.mockResolvedValue({ batchId: 'b1', status: 'completed', totalRows: 1, importedCount: 1, duplicateCount: 0, errorCount: 0, rows: [] });
    const { hook, invalidateSpy } = setup({ isSuperAdmin: true, companyId: 'company-a' });
    await hook.result.current.commit(PAYLOAD);
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: platformCommercialQueryKeys.leadsRoot('company-a') }));
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.root('company-a') });
  });

  it('commit 100% duplicado/erro (importedCount=0): NUNCA invalida cache — nada mudou na listagem', async () => {
    mocks.commitBulkImportLeads.mockResolvedValue({ batchId: 'b1', status: 'completed', totalRows: 1, importedCount: 0, duplicateCount: 1, errorCount: 0, rows: [] });
    const { hook, invalidateSpy } = setup();
    await hook.result.current.commit(PAYLOAD);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
