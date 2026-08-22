// lib/sales/errors.ts — erros tipados do caminho remoto de Sales
// (COMMERCIAL-REMOTE-SALES-A2). Mesmo padrão de lib/deals/errors.ts:
// mensagens/códigos ESTÁVEIS, nunca exibidos crus ao usuário; a causa
// técnica fica em `detail`, já higienizada — nunca token, credencial, URL
// ou query completa.
import type { SaleAdapterError } from '@/lib/sales/adapter';

export type RemoteSalesErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_sales_fetch_failed'
  // Flag/mode sale_remote_ready mas o dado remoto é inválido para a
  // IDENTIDADE atual (reservado para uso futuro, mesmo papel de
  // remote_deals_invalid_context).
  | 'remote_sales_invalid_context'
  | RemoteSalesMutationErrorCode;

// Códigos da mutation (register_sale) — mapeados EXATAMENTE a partir das
// mensagens estáveis que a RPC lança (`raise exception '<codigo>'`,
// supabase/migrations/20260822090000_commercial_remote_sales_a1.sql,
// reconfirmado sem depender de memória neste EXEC) — nunca um código
// inventado além do que o SQL realmente lança. Sem cancel/update/delete —
// Sale é imutável neste V1, nenhum vestígio desses conceitos aqui.
// `identity_changed` é o único código desta lista que NUNCA vem do
// backend: é lançado localmente pelo generation guard
// (lib/sales/mutationGeneration.ts) quando a geração do cache muda entre o
// início e o fim da mutation — mesmo contrato de
// remote_deals_mutation_identity_changed. `generic_error` é o fallback
// seguro para qualquer mensagem não reconhecida (inclui o caso de
// payment_method fora do enum: Postgres rejeita com 22P02 antes de a RPC
// lançar qualquer exceção de negócio, então essa mensagem nunca bate no
// mapa abaixo e cai no fallback genérico).
export type RemoteSalesMutationErrorCode =
  | 'remote_sales_mutation_forbidden'
  | 'remote_sales_mutation_deal_not_found'
  | 'remote_sales_mutation_deal_closed'
  | 'remote_sales_mutation_stale_write'
  | 'remote_sales_mutation_invalid_value'
  | 'remote_sales_mutation_invalid_payment_method'
  | 'remote_sales_mutation_identity_changed'
  | 'remote_sales_mutation_generic_error';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteSalesErrorDetail {
  code?: string;
  message?: string;
  adapterError?: SaleAdapterError;
  operation?: string;
}

export class RemoteSalesError extends Error {
  readonly code: RemoteSalesErrorCode;
  readonly detail: RemoteSalesErrorDetail;

  constructor(code: RemoteSalesErrorCode, detail: RemoteSalesErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (mesmo modelo de
    // RemoteDealsError/RemoteVisitsError/RemoteTasksError).
    super(code);
    this.name = 'RemoteSalesError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteSalesError(error: unknown): error is RemoteSalesError {
  return error instanceof RemoteSalesError;
}

// Mapa mensagem-estável -> código namespaced. Espelha EXATAMENTE as
// mensagens de `raise exception` confirmadas na migration #54 — nenhum
// valor inventado além do que o SQL realmente lança.
const REMOTE_SALES_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteSalesMutationErrorCode>> = {
  forbidden: 'remote_sales_mutation_forbidden',
  deal_not_found: 'remote_sales_mutation_deal_not_found',
  deal_closed: 'remote_sales_mutation_deal_closed',
  stale_write: 'remote_sales_mutation_stale_write',
  invalid_value: 'remote_sales_mutation_invalid_value',
  invalid_payment_method: 'remote_sales_mutation_invalid_payment_method',
};

// Mensagens PT-BR renderizadas pelo formulário remoto de Registrar venda
// (FlowRegistrarVenda, ramo remoto). Vocabulário do pivot: "negociação" em
// todo lugar, nenhuma referência a aprovação.
export const REMOTE_SALES_MUTATION_ERROR_MESSAGES_PT: Readonly<Record<RemoteSalesMutationErrorCode, string>> = {
  remote_sales_mutation_forbidden: 'Você não tem permissão para registrar esta venda.',
  remote_sales_mutation_deal_not_found: 'Esta negociação não está mais disponível.',
  remote_sales_mutation_deal_closed: 'Esta negociação já foi encerrada.',
  remote_sales_mutation_stale_write: 'Esta negociação foi alterada. Os dados foram atualizados.',
  remote_sales_mutation_invalid_value: 'Informe um valor de venda válido.',
  remote_sales_mutation_invalid_payment_method: 'Selecione uma forma de pagamento.',
  remote_sales_mutation_identity_changed: 'Sua sessão mudou. Tente novamente.',
  remote_sales_mutation_generic_error: 'Não foi possível concluir a ação. Tente novamente.',
};

// Converte um erro cru do Supabase (register_sale) num RemoteSalesError com
// código namespaced e detail sanitizado. Mensagem não reconhecida SEMPRE
// vira `remote_sales_mutation_generic_error` — nunca é adivinhada como um
// código específico (sem substring matching amplo).
export function mapRemoteSalesMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteSalesError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_SALES_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteSalesError(mappedCode ?? 'remote_sales_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Erro LOCAL (nunca vem do backend): lançado pelo generation guard
// (lib/sales/mutationGeneration.ts) quando a geração do cache
// (lib/query/cacheIdentity.ts) muda entre o início e o fim de uma
// mutation — logout, troca de empresa/membership, ou qualquer
// resetQueryCache() em voo.
export function createSaleIdentityChangedMutationError(operation: string): RemoteSalesError {
  return new RemoteSalesError('remote_sales_mutation_identity_changed', { operation });
}
