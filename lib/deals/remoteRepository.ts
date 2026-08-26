// lib/deals/remoteRepository.ts — leitura E mutations remotas de Deals
// (COMMERCIAL-REMOTE-DEALS-B2-A read + B2-B mutations). Sem React, sem
// localStorage, sem DealService/StoreAdapter, sem queryClient/snapshot —
// responsabilidade única: payload TypeScript → RPC/query Supabase →
// RemoteDealRow cru. Cache, invalidação e notificação são responsabilidade
// dos hooks (mesma separação de lib/visits/remoteRepository.ts +
// lib/visits/remoteMutationRepository.ts — aqui em um único arquivo,
// proporcional ao tamanho do domínio: Deals tem só 3 RPCs, contra 5 de
// Visits — B2-B-PRECHECK §3, desvio deliberado de arquivo, não de
// contrato).
//
// Contrato reconfirmado diretamente em supabase/migrations/
// 20260821130000_commercial_remote_deals_b1.sql (nunca só pelos relatórios
// anteriores) — nenhuma das 3 RPCs aceita p_company_id:
// resolve_commercial_mutation_context() deriva a empresa SEMPRE de
// auth.uid() via company_memberships, mesmo contrato de Tasks/Visits.
// Nenhuma regra de negócio (seller default do Lead, threshold de
// desconto — que não existe mais — etc.) é decidida aqui — o backend é a
// única autoridade; este módulo só representa o contrato.
//
// Migration #53 (public.deals) ainda NÃO existe no banco remoto — este
// módulo só é exercitado quando resolveDealRemoteMode() === 'deal_remote_ready'
// (feature flag NEXT_PUBLIC_FF_REMOTE_DEALS, default OFF), nunca chamado
// incondicionalmente.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { RemoteDealsError, mapRemoteDealsMutationError } from '@/lib/deals/errors';

type DealPaymentMethod = Database['public']['Enums']['deal_payment_method'];

// Ordenação estável e determinística: created_at descendente (mais
// recentes primeiro) com id ascendente como desempate — mesmo padrão de
// fetchVisibleVisitRows/fetchPendingTaskRows, consistente com os índices
// já criados na migration #53 (deals_company_status_created_idx).
export async function fetchVisibleDealRows(): Promise<RemoteDealRow[]> {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem URL, sem query.
    throw new RemoteDealsError('remote_deals_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteDealRow[];
}

// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — bridge EXCLUSIVO do
// Super Admin contextual (/company/[id]): chama list_platform_deals_for_
// company (SECURITY DEFINER, company explícita + can_access_company),
// nunca o SELECT direto acima. Manager/Seller continuam 100% em
// fetchVisibleDealRows/RLS — esta função nunca é chamada para eles.
// Mesmo shape de row (RemoteDealRow), sem filtro de status (paridade
// exata com fetchVisibleDealRows).
export async function fetchPlatformDealRows(companyId: string): Promise<RemoteDealRow[]> {
  const { data, error } = await supabase.rpc('list_platform_deals_for_company', {
    p_company_id: companyId,
  });

  if (error) {
    throw new RemoteDealsError('remote_deals_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteDealRow[];
}

// ── create_deal ───────────────────────────────────────────────────────
// p_lead_id/p_vehicle/p_value_cents/p_discount_percent/p_payment_method
// obrigatórios (sem default no SQL); p_down_payment_cents/p_installments/
// p_note/p_assigned_seller_id têm default null/null/''/null no SQL —
// espelhados aqui como opcionais. Sempre nasce 'open' — discount nunca
// controla status (decidido pelo BACKEND, nunca aqui). Seller default a
// partir do Lead, seller_required etc. são decididos pelo backend — este
// repository nunca resolve/valida nada disso.
export type CreateRemoteDealPayload = {
  leadId: string;
  vehicle: string;
  valueCents: number;
  discountPercent: number;
  paymentMethod: DealPaymentMethod;
  downPaymentCents?: number | null;
  installments?: string | null;
  note?: string;
  assignedSellerId?: string | null;
};

// ── update_deal ──────────────────────────────────────────────────────
// PONTO CRÍTICO (mesmo de update_visit/update_task): update_deal é FULL
// REPLACE, nunca PATCH parcial — vehicle/valueCents/discountPercent/
// paymentMethod/downPaymentCents/installments/note/assignedSellerId são
// todos obrigatórios no SQL (os 4 últimos têm default no SQL, mas por ser
// full replace o caller sempre precisa reenviar o estado completo
// desejado). leadId/companyId/status/clientNameSnapshot/actors/lost
// metadata/version final nunca são parâmetros — nenhum existe aqui.
export type UpdateRemoteDealPayload = {
  dealId: string;
  expectedVersion: number;
  vehicle: string;
  valueCents: number;
  discountPercent: number;
  paymentMethod: DealPaymentMethod;
  downPaymentCents: number | null;
  installments: string | null;
  note: string;
  assignedSellerId: string;
};

// ── mark_deal_lost ───────────────────────────────────────────────────
// Nada além de id/expectedVersion — mark_deal_lost não aceita nenhum
// outro parâmetro (sem lostReason, sem note obrigatório, sem aprovação).
export type MarkRemoteDealLostPayload = {
  dealId: string;
  expectedVersion: number;
};

// create_deal sempre retorna a linha criada quando não há erro — data=null
// sem error é anômalo (mesmo padrão de createRemoteVisit/createRemoteTask).
export async function createRemoteDeal(payload: CreateRemoteDealPayload): Promise<RemoteDealRow> {
  const { data, error } = await supabase.rpc('create_deal', {
    p_lead_id: payload.leadId,
    p_vehicle: payload.vehicle,
    p_value_cents: payload.valueCents,
    p_discount_percent: payload.discountPercent,
    p_payment_method: payload.paymentMethod,
    p_down_payment_cents: payload.downPaymentCents ?? null,
    p_installments: payload.installments ?? null,
    p_note: payload.note ?? '',
    p_assigned_seller_id: payload.assignedSellerId ?? null,
  });
  if (error) throw mapRemoteDealsMutationError(error, 'create_deal');
  if (!data) throw mapRemoteDealsMutationError({ message: 'empty_response' }, 'create_deal');
  return data as RemoteDealRow;
}

// Nenhum campo omitido — editar apenas o desconto, por exemplo, exige
// reenviar vehicle/valueCents/paymentMethod/... ATUAIS (o caller, não este
// repository, é quem busca o valor atual antes de montar o payload).
export async function updateRemoteDeal(payload: UpdateRemoteDealPayload): Promise<RemoteDealRow> {
  const { data, error } = await supabase.rpc('update_deal', {
    p_id: payload.dealId,
    p_expected_version: payload.expectedVersion,
    p_vehicle: payload.vehicle,
    p_value_cents: payload.valueCents,
    p_discount_percent: payload.discountPercent,
    p_payment_method: payload.paymentMethod,
    p_down_payment_cents: payload.downPaymentCents,
    p_installments: payload.installments,
    p_note: payload.note,
    p_assigned_seller_id: payload.assignedSellerId,
  });
  if (error) throw mapRemoteDealsMutationError(error, 'update_deal');
  if (!data) throw mapRemoteDealsMutationError({ message: 'empty_response' }, 'update_deal');
  return data as RemoteDealRow;
}

export async function markRemoteDealLost(payload: MarkRemoteDealLostPayload): Promise<RemoteDealRow> {
  const { data, error } = await supabase.rpc('mark_deal_lost', {
    p_id: payload.dealId,
    p_expected_version: payload.expectedVersion,
  });
  if (error) throw mapRemoteDealsMutationError(error, 'mark_deal_lost');
  if (!data) throw mapRemoteDealsMutationError({ message: 'empty_response' }, 'mark_deal_lost');
  return data as RemoteDealRow;
}
