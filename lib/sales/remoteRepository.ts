// lib/sales/remoteRepository.ts — leitura E mutation remotas de Sales
// (COMMERCIAL-REMOTE-SALES-A2). Sem React, sem localStorage, sem
// SaleService/StoreAdapter, sem queryClient/snapshot — responsabilidade
// única: payload TypeScript → RPC/query Supabase → RemoteSaleRow cru (ou
// RemoteDealRow cru, no caso de register_sale — a RPC retorna a Deal
// atualizada, nunca a Sale). Cache, invalidação e notificação são
// responsabilidade dos hooks (mesma separação de lib/deals/remoteRepository.ts).
//
// Contrato reconfirmado diretamente em supabase/migrations/
// 20260822090000_commercial_remote_sales_a1.sql (nunca só pela memória
// deste EXEC) — register_sale não aceita p_company_id/p_lead_id/
// p_assigned_seller_id/p_sold_by: todos derivados da própria Deal, dentro
// da RPC, nunca do cliente (SALES-A1-PRECHECK §6/§15).
//
// Migration #54 (public.sales) ainda NÃO existe no banco remoto — este
// módulo só é exercitado quando resolveSalesRemoteMode() === 'sale_remote_ready'
// (feature flag NEXT_PUBLIC_FF_REMOTE_SALES, default OFF), nunca chamado
// incondicionalmente.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RemoteSaleRow } from '@/lib/sales/adapter';
import { RemoteSalesError, mapRemoteSalesMutationError } from '@/lib/sales/errors';

type DealPaymentMethod = Database['public']['Enums']['deal_payment_method'];
type RemoteDealRow = Database['public']['Tables']['deals']['Row'];

// Ordenação estável e determinística: sold_at descendente (vendas mais
// recentes primeiro) com id ascendente como desempate — mesmo padrão de
// fetchVisibleDealRows, consistente com o index já criado na migration #54
// (sales_company_sold_at_idx).
export async function fetchVisibleSaleRows(): Promise<RemoteSaleRow[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .order('sold_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem URL, sem query.
    throw new RemoteSalesError('remote_sales_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteSaleRow[];
}

// ── register_sale ─────────────────────────────────────────────────────
// Único input real: dealId/expectedVersion/soldValueCents/paymentMethod.
// company_id/lead_id/assigned_seller_id/sold_by NUNCA são parâmetros —
// nenhum existe aqui (backend deriva tudo da própria Deal, já travada
// dentro da RPC).
export type RegisterRemoteSalePayload = {
  dealId: string;
  expectedVersion: number;
  soldValueCents: number;
  paymentMethod: DealPaymentMethod;
};

// register_sale retorna a DEAL ATUALIZADA (status='sold', version+1) —
// nunca a Sale em si (migration #54, SALES-A1-PRECHECK §17). A Sale fica
// persistida em public.sales, consultável via fetchVisibleSaleRows.
export async function registerRemoteSale(payload: RegisterRemoteSalePayload): Promise<RemoteDealRow> {
  const { data, error } = await supabase.rpc('register_sale', {
    p_deal_id: payload.dealId,
    p_expected_version: payload.expectedVersion,
    p_sold_value_cents: payload.soldValueCents,
    p_payment_method: payload.paymentMethod,
  });
  if (error) throw mapRemoteSalesMutationError(error, 'register_sale');
  if (!data) throw mapRemoteSalesMutationError({ message: 'empty_response' }, 'register_sale');
  return data as RemoteDealRow;
}
