// lib/deals/errors.ts — erros tipados do caminho remoto de Deals
// (COMMERCIAL-REMOTE-DEALS-B2-A read + B2-B mutations). Mesmo padrão de
// lib/visits/errors.ts/lib/tasks/errors.ts: mensagens/códigos ESTÁVEIS,
// nunca exibidos crus ao usuário; a causa técnica fica em `detail`, já
// higienizada — nunca token, credencial, URL ou query completa.
import type { DealAdapterError } from '@/lib/deals/adapter';

export type RemoteDealsErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_deals_fetch_failed'
  // Flag/mode deal_remote_ready mas o dado remoto é inválido para a
  // IDENTIDADE atual (reservado para uso futuro por uma composição de
  // screen-state, mesmo papel de remote_visits_invalid_context/
  // remote_tasks_invalid_context).
  | 'remote_deals_invalid_context'
  | RemoteDealsMutationErrorCode;

// Códigos das mutations (create_deal/update_deal/mark_deal_lost) —
// mapeados EXATAMENTE a partir das mensagens estáveis que as RPCs lançam
// (`raise exception '<codigo>'`, supabase/migrations/
// 20260821130000_commercial_remote_deals_b1.sql, reconfirmado sem depender
// de memória neste EXEC §3) — nunca um código inventado além do que o SQL
// realmente lança. Sem approve/reject/pending_approval — o workflow de
// aprovação foi removido no pivot de produto, nenhum vestígio aqui.
// `identity_changed` é o único código desta lista que NUNCA vem do
// backend: é lançado localmente pelo generation guard
// (lib/deals/mutationGeneration.ts) quando a geração do cache muda entre o
// início e o fim da mutation — mesmo contrato de
// remote_visits_mutation_identity_changed/remote_tasks_mutation_identity_changed.
// `generic_error` é o fallback seguro para qualquer mensagem não
// reconhecida — nunca uma mensagem desconhecida vira um código específico
// por adivinhação (inclui o caso de payment_method fora do enum: Postgres
// rejeita com 22P02 antes de a RPC lançar qualquer exceção de negócio,
// então essa mensagem nunca bate no mapa abaixo e cai no fallback
// genérico).
export type RemoteDealsMutationErrorCode =
  | 'remote_deals_mutation_forbidden'
  | 'remote_deals_mutation_lead_not_found'
  | 'remote_deals_mutation_lead_archived'
  | 'remote_deals_mutation_seller_required'
  | 'remote_deals_mutation_seller_not_found'
  | 'remote_deals_mutation_invalid_vehicle'
  | 'remote_deals_mutation_invalid_value'
  | 'remote_deals_mutation_invalid_discount'
  | 'remote_deals_mutation_deal_not_found'
  | 'remote_deals_mutation_deal_closed'
  | 'remote_deals_mutation_stale_write'
  | 'remote_deals_mutation_identity_changed'
  | 'remote_deals_mutation_generic_error';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteDealsErrorDetail {
  code?: string;
  message?: string;
  adapterError?: DealAdapterError;
  operation?: string;
}

export class RemoteDealsError extends Error {
  readonly code: RemoteDealsErrorCode;
  readonly detail: RemoteDealsErrorDetail;

  constructor(code: RemoteDealsErrorCode, detail: RemoteDealsErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (mesmo modelo de
    // RemoteVisitsError/RemoteTasksError).
    super(code);
    this.name = 'RemoteDealsError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteDealsError(error: unknown): error is RemoteDealsError {
  return error instanceof RemoteDealsError;
}

// Mapa mensagem-estável -> código namespaced. Espelha EXATAMENTE as
// mensagens de `raise exception` confirmadas na migration #53 — nenhum
// valor inventado além do que o SQL realmente lança.
const REMOTE_DEALS_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteDealsMutationErrorCode>> = {
  forbidden: 'remote_deals_mutation_forbidden',
  lead_not_found: 'remote_deals_mutation_lead_not_found',
  lead_archived: 'remote_deals_mutation_lead_archived',
  seller_required: 'remote_deals_mutation_seller_required',
  seller_not_found: 'remote_deals_mutation_seller_not_found',
  invalid_vehicle: 'remote_deals_mutation_invalid_vehicle',
  invalid_value: 'remote_deals_mutation_invalid_value',
  invalid_discount: 'remote_deals_mutation_invalid_discount',
  deal_not_found: 'remote_deals_mutation_deal_not_found',
  deal_closed: 'remote_deals_mutation_deal_closed',
  stale_write: 'remote_deals_mutation_stale_write',
};

// Mensagens conceituais para uma futura UI (B4+) — NÃO renderizadas por
// nenhum componente neste lote (B2-B é infraestrutura, sem UI). Mantidas
// aqui, junto do código que as origina, para não divergir quando a UI
// finalmente consumir estes códigos. Vocabulário do pivot: nenhuma
// referência a aprovação/proposta — "negociação" em todo lugar.
export const REMOTE_DEALS_MUTATION_ERROR_MESSAGES_PT: Readonly<Record<RemoteDealsMutationErrorCode, string>> = {
  remote_deals_mutation_forbidden: 'Você não tem permissão para alterar esta negociação.',
  remote_deals_mutation_lead_not_found: 'O cliente vinculado não está disponível.',
  remote_deals_mutation_lead_archived: 'Este cliente já foi arquivado.',
  remote_deals_mutation_seller_required: 'Selecione um vendedor responsável.',
  remote_deals_mutation_seller_not_found: 'O vendedor selecionado não está disponível.',
  remote_deals_mutation_invalid_vehicle: 'Informe um veículo válido.',
  remote_deals_mutation_invalid_value: 'Informe um valor válido.',
  remote_deals_mutation_invalid_discount: 'O desconto precisa estar entre 0% e 10%.',
  remote_deals_mutation_deal_not_found: 'Esta negociação não está mais disponível.',
  remote_deals_mutation_deal_closed: 'Esta negociação já foi encerrada.',
  remote_deals_mutation_stale_write: 'Esta negociação foi alterada. Os dados foram atualizados.',
  remote_deals_mutation_identity_changed: 'Sua sessão mudou. Tente novamente.',
  remote_deals_mutation_generic_error: 'Não foi possível concluir a ação. Tente novamente.',
};

// Converte um erro cru do Supabase (create_deal/update_deal/
// mark_deal_lost) num RemoteDealsError com código namespaced e detail
// sanitizado. Mensagem não reconhecida SEMPRE vira
// `remote_deals_mutation_generic_error` — nunca é adivinhada como um
// código específico (sem substring matching amplo).
export function mapRemoteDealsMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteDealsError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_DEALS_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteDealsError(mappedCode ?? 'remote_deals_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Erro LOCAL (nunca vem do backend): lançado pelo generation guard
// (lib/deals/mutationGeneration.ts) quando a geração do cache
// (lib/query/cacheIdentity.ts) muda entre o início e o fim de uma
// mutation — logout, troca de empresa/membership, ou qualquer
// resetQueryCache() em voo.
export function createDealIdentityChangedMutationError(operation: string): RemoteDealsError {
  return new RemoteDealsError('remote_deals_mutation_identity_changed', { operation });
}
