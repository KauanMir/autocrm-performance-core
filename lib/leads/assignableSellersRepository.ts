// lib/leads/assignableSellersRepository.ts — leitura de Sellers
// OPERACIONAIS (catálogo de atribuição) para Manager/Seller (M1-E, E4-A1).
// Arquivo próprio, deliberadamente separado de lib/leads/sellerLabelsRepository.ts
// (catálogo de EXIBIÇÃO — inclui históricos/inativos, nunca usado como
// picker de nova atribuição, decisão do E3-A1) e de lib/leads/errors.ts (cujo
// contrato de exatamente 4 códigos é do E3 e não é alterado aqui). SOMENTE
// leitura: nenhuma RPC de escrita, nenhum acesso a store, localStorage ou
// React.
//
// A RPC (public.list_current_company_assignable_sellers) não recebe nenhum
// parâmetro de empresa — a empresa é resolvida inteiramente no servidor a
// partir da membership ativa do usuário autenticado (auth.uid()). O
// frontend nunca envia company_id nem qualquer outro identificador de
// empresa para esta chamada.
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { LeadSellerRef } from '@/lib/leads/adapter';

export type AssignableSellerRow =
  Database['public']['Functions']['list_current_company_assignable_sellers']['Returns'][number];

export type AssignableSellersErrorCode = 'assignable_sellers_fetch_failed';

export interface AssignableSellersErrorDetail {
  code?: string;
  message?: string;
}

export class AssignableSellersError extends Error {
  readonly code: AssignableSellersErrorCode;
  readonly detail: AssignableSellersErrorDetail;

  constructor(code: AssignableSellersErrorCode, detail: AssignableSellersErrorDetail = {}) {
    // message = código estável — nada interno do banco vaza para a UI
    // (mesmo padrão de RemoteLeadsError/SellerLabelsError).
    super(code);
    this.name = 'AssignableSellersError';
    this.code = code;
    this.detail = detail;
  }
}

// Erro NUNCA vira lista vazia: ausência real de Sellers operacionais é um
// array vazio válido vindo do banco (ex.: Manager de empresa nova, sem
// nenhum Seller ativo ainda); falha de rede/RLS/Postgres é sempre um throw
// explícito — os dois estados nunca se confundem.
export async function fetchCurrentCompanyAssignableSellers(): Promise<AssignableSellerRow[]> {
  const { data, error } = await supabase.rpc('list_current_company_assignable_sellers');

  if (error) {
    throw new AssignableSellersError('assignable_sellers_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return data ?? [];
}

// Formato intermediário coerente com adaptLeadRows (lib/leads/adapter.ts,
// intocado por esta etapa): LeadAdapterContext.sellersById espera
// exatamente Record<string, { id, name }>, indexado por sellers.id — mesmo
// shape que toSellersByIdIndex (sellerLabelsRepository.ts) produz. Linha
// duplicada (não deveria ocorrer — seller_id é PK) usa a ÚLTIMA ocorrência,
// nunca lança.
export function toAssignableSellersByIdIndex(
  rows: readonly AssignableSellerRow[],
): Readonly<Record<string, LeadSellerRef>> {
  const index: Record<string, LeadSellerRef> = {};
  for (const row of rows) {
    index[row.seller_id] = { id: row.seller_id, name: row.name };
  }
  return index;
}
