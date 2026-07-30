// Testes do repositório de seller labels (M1-E, E3-A1).
// Mock isolado de lib/supabase/client (rpc), sem rede real. Prova: chamada
// exata sem argumentos, erro nunca vira lista vazia, detail sanitizado, e
// toSellersByIdIndex produz o formato consumido por adaptLeadRows.
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCurrentCompanySellerLabels,
  toSellersByIdIndex,
  SellerLabelsError,
  type SellerLabelRow,
} from '@/lib/leads/sellerLabelsRepository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

describe('fetchCurrentCompanySellerLabels — forma exata da chamada', () => {
  it('chama list_current_company_seller_labels sem nenhum argumento', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchCurrentCompanySellerLabels();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('list_current_company_seller_labels');
  });

  it('retorna seller_id e name exatamente como recebidos, preservando ordem', async () => {
    const rows: SellerLabelRow[] = [
      { seller_id: 's1', name: 'Ana' },
      { seller_id: 's2', name: 'Bruno' },
    ];
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const result = await fetchCurrentCompanySellerLabels();
    expect(result).toEqual(rows);
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchCurrentCompanySellerLabels()).resolves.toEqual([]);
  });
});

describe('fetchCurrentCompanySellerLabels — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança SellerLabelsError seller_labels_fetch_failed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } });
    const failure = fetchCurrentCompanySellerLabels();
    await expect(failure).rejects.toBeInstanceOf(SellerLabelsError);
    await expect(failure).rejects.toMatchObject({ code: 'seller_labels_fetch_failed' });
  });

  it('detail preserva somente código e mensagem — sem PII ou dado interno', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'forbidden',
        code: '42501',
        apikey: 'nunca-copiar',
        details: 'internos',
        hint: 'interno',
      },
    });
    const error = await fetchCurrentCompanySellerLabels().catch((e) => e);
    expect(error).toBeInstanceOf(SellerLabelsError);
    expect(error.detail).toEqual({ code: '42501', message: 'forbidden' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('seller_labels_fetch_failed');
  });
});

describe('toSellersByIdIndex — formato consumido por adaptLeadRows', () => {
  it('indexa por seller_id real, com id e name reais (sem placeholder)', () => {
    const rows: SellerLabelRow[] = [
      { seller_id: 's1', name: 'Ana' },
      { seller_id: 's2', name: 'Bruno' },
    ];
    const index = toSellersByIdIndex(rows);
    expect(index).toEqual({
      s1: { id: 's1', name: 'Ana' },
      s2: { id: 's2', name: 'Bruno' },
    });
  });

  it('lista vazia produz índice vazio', () => {
    expect(toSellersByIdIndex([])).toEqual({});
  });

  it('nunca expõe seller_id como name (id e name distintos preservados)', () => {
    const index = toSellersByIdIndex([{ seller_id: 's1', name: 'Ana' }]);
    expect(index.s1.name).toBe('Ana');
    expect(index.s1.name).not.toBe('s1');
  });
});
