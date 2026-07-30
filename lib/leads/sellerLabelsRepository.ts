// lib/leads/sellerLabelsRepository.ts — leitura remota de seller_id -> name
// para Manager/Seller (M1-E, E3-A1). Arquivo próprio, deliberadamente
// separado de lib/leads/errors.ts (cujo contrato de exatamente 4 códigos é
// do E3 e não é alterado aqui) e de lib/leads/remoteRepository.ts (que só
// lê leads). SOMENTE leitura: nenhuma RPC de escrita, nenhum acesso a
// store, localStorage ou React.
//
// A RPC (public.list_current_company_seller_labels) não recebe nenhum
// parâmetro de empresa — a empresa é resolvida inteiramente no servidor a
// partir da membership ativa do usuário autenticado (auth.uid()). O
// frontend nunca envia company_id nem qualquer outro identificador de
// empresa para esta chamada.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { LeadSellerRef } from '@/lib/leads/adapter';

export type SellerLabelRow =
  Database['public']['Functions']['list_current_company_seller_labels']['Returns'][number];

export type SellerLabelsErrorCode = 'seller_labels_fetch_failed';

export interface SellerLabelsErrorDetail {
  code?: string;
  message?: string;
}

export class SellerLabelsError extends Error {
  readonly code: SellerLabelsErrorCode;
  readonly detail: SellerLabelsErrorDetail;

  constructor(code: SellerLabelsErrorCode, detail: SellerLabelsErrorDetail = {}) {
    // message = código estável — nada interno do banco vaza para a UI
    // (mesmo padrão de RemoteLeadsError/lib/leads/errors.ts).
    super(code);
    this.name = 'SellerLabelsError';
    this.code = code;
    this.detail = detail;
  }
}

// Erro NUNCA vira lista vazia: ausência real de sellers é um array vazio
// válido vindo do banco (ex.: Manager de empresa nova, sem nenhum Seller
// ainda); falha de rede/RLS/Postgres é sempre um throw explícito — os dois
// estados nunca se confundem.
export async function fetchCurrentCompanySellerLabels(): Promise<SellerLabelRow[]> {
  const { data, error } = await supabase.rpc('list_current_company_seller_labels');

  if (error) {
    throw new SellerLabelsError('seller_labels_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return data ?? [];
}

// Formato intermediário coerente com adaptLeadRows (lib/leads/adapter.ts,
// intocado por esta etapa): LeadAdapterContext.sellersById espera
// exatamente Record<string, { id, name }>, indexado por sellers.id — mesmo
// shape que este mapper produz, aplicado puramente (sem rede, sem React).
// Linha duplicada (não deveria ocorrer — seller_id é PK) usa a ÚLTIMA
// ocorrência, nunca lança: quem decide se isso é um erro de configuração é
// o próprio adapter, não este mapper.
export function toSellersByIdIndex(
  rows: readonly SellerLabelRow[],
): Readonly<Record<string, LeadSellerRef>> {
  const index: Record<string, LeadSellerRef> = {};
  for (const row of rows) {
    index[row.seller_id] = { id: row.seller_id, name: row.name };
  }
  return index;
}
