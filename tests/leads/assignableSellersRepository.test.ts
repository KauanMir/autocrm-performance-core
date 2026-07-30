// Testes do repositório de Sellers assignable (M1-E, E4-A1).
// Mock isolado de lib/supabase/client (rpc), sem rede real. Prova: chamada
// exata sem argumentos, erro nunca vira lista vazia, detail sanitizado, e
// toAssignableSellersByIdIndex produz o formato consumido por
// LeadAdapterContext.sellersById (mesmo shape de toSellersByIdIndex).
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCurrentCompanyAssignableSellers,
  toAssignableSellersByIdIndex,
  AssignableSellersError,
  type AssignableSellerRow,
} from '@/lib/leads/assignableSellersRepository';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

describe('fetchCurrentCompanyAssignableSellers — forma exata da chamada', () => {
  it('chama list_current_company_assignable_sellers sem nenhum argumento', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchCurrentCompanyAssignableSellers();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('list_current_company_assignable_sellers');
  });

  it('retorna seller_id e name exatamente como recebidos, preservando ordem', async () => {
    const rows: AssignableSellerRow[] = [
      { seller_id: 's1', name: 'Ana' },
      { seller_id: 's2', name: 'Bruno' },
    ];
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const result = await fetchCurrentCompanyAssignableSellers();
    expect(result).toEqual(rows);
  });

  it('data null é lista vazia VÁLIDA (sem erro)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchCurrentCompanyAssignableSellers()).resolves.toEqual([]);
  });
});

describe('fetchCurrentCompanyAssignableSellers — erros', () => {
  it('erro do Supabase NÃO vira lista vazia: lança AssignableSellersError assignable_sellers_fetch_failed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden', code: '42501' } });
    const failure = fetchCurrentCompanyAssignableSellers();
    await expect(failure).rejects.toBeInstanceOf(AssignableSellersError);
    await expect(failure).rejects.toMatchObject({ code: 'assignable_sellers_fetch_failed' });
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
    const error = await fetchCurrentCompanyAssignableSellers().catch((e) => e);
    expect(error).toBeInstanceOf(AssignableSellersError);
    expect(error.detail).toEqual({ code: '42501', message: 'forbidden' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
    expect(error.message).toBe('assignable_sellers_fetch_failed');
  });
});

describe('toAssignableSellersByIdIndex — formato consumido por adaptLeadRows', () => {
  it('indexa por seller_id real, com id e name reais (sem placeholder)', () => {
    const rows: AssignableSellerRow[] = [
      { seller_id: 's1', name: 'Ana' },
      { seller_id: 's2', name: 'Bruno' },
    ];
    const index = toAssignableSellersByIdIndex(rows);
    expect(index).toEqual({
      s1: { id: 's1', name: 'Ana' },
      s2: { id: 's2', name: 'Bruno' },
    });
  });

  it('lista vazia produz índice vazio', () => {
    expect(toAssignableSellersByIdIndex([])).toEqual({});
  });

  it('nunca expõe seller_id como name (id e name distintos preservados)', () => {
    const index = toAssignableSellersByIdIndex([{ seller_id: 's1', name: 'Ana' }]);
    expect(index.s1.name).toBe('Ana');
    expect(index.s1.name).not.toBe('s1');
  });
});
