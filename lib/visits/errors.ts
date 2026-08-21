// lib/visits/errors.ts — erros tipados do caminho remoto de Visits
// (COMMERCIAL-REMOTE-VISITS-B2-A read + B2-B mutations). Mesmo padrão de
// lib/tasks/errors.ts: mensagens/códigos ESTÁVEIS, nunca exibidos crus ao
// usuário; a causa técnica fica em `detail`, já higienizada — nunca token,
// credencial, URL ou query completa.
import type { VisitAdapterError } from '@/lib/visits/adapter';

export type RemoteVisitsErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_visits_fetch_failed'
  // Flag/mode visit_remote_ready mas o dado remoto é inválido para a
  // IDENTIDADE atual (reservado para uso futuro por uma composição de
  // screen-state, mesmo papel de remote_tasks_invalid_context).
  | 'remote_visits_invalid_context'
  | RemoteVisitsMutationErrorCode;

// Códigos das mutations (create_visit/update_visit/confirm_visit/
// cancel_visit/register_visit_result) — mapeados EXATAMENTE a partir das
// mensagens estáveis que as RPCs lançam (`raise exception '<codigo>'`,
// supabase/migrations/20260821100000_commercial_remote_visits_b1.sql,
// reconfirmado sem depender de memória neste EXEC §2) — nunca um código
// inventado além do que o SQL realmente lança. `identity_changed` é o
// único código desta lista que NUNCA vem do backend: é lançado localmente
// pelo generation guard (lib/visits/mutationGeneration.ts) quando a
// geração do cache muda entre o início e o fim da mutation (logout/troca
// de empresa/membership em voo) — mesmo contrato de
// remote_tasks_mutation_identity_changed. `generic_error` é o fallback
// seguro para qualquer mensagem não reconhecida — nunca uma mensagem
// desconhecida vira um código específico por adivinhação (inclui o caso
// de p_outcome fora do enum: Postgres rejeita com 22P02 antes de a RPC
// lançar qualquer exceção de negócio, então essa mensagem nunca bate no
// mapa abaixo e cai no fallback genérico — a UI futura, de qualquer
// forma, só pode montar um outcome tipado, tornando esse caminho
// praticamente inatingível a partir de um input real).
export type RemoteVisitsMutationErrorCode =
  | 'remote_visits_mutation_forbidden'
  | 'remote_visits_mutation_seller_required'
  | 'remote_visits_mutation_seller_not_found'
  | 'remote_visits_mutation_lead_not_found'
  | 'remote_visits_mutation_lead_archived'
  | 'remote_visits_mutation_client_name_required'
  | 'remote_visits_mutation_invalid_vehicles'
  | 'remote_visits_mutation_visit_not_found'
  | 'remote_visits_mutation_visit_closed'
  | 'remote_visits_mutation_invalid_status_transition'
  | 'remote_visits_mutation_stale_write'
  | 'remote_visits_mutation_identity_changed'
  | 'remote_visits_mutation_generic_error';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteVisitsErrorDetail {
  code?: string;
  message?: string;
  adapterError?: VisitAdapterError;
  operation?: string;
}

export class RemoteVisitsError extends Error {
  readonly code: RemoteVisitsErrorCode;
  readonly detail: RemoteVisitsErrorDetail;

  constructor(code: RemoteVisitsErrorCode, detail: RemoteVisitsErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (mesmo modelo de RemoteTasksError).
    super(code);
    this.name = 'RemoteVisitsError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteVisitsError(error: unknown): error is RemoteVisitsError {
  return error instanceof RemoteVisitsError;
}

// Mapa mensagem-estável -> código namespaced. Espelha EXATAMENTE as 11
// mensagens de `raise exception` confirmadas na migration #52 — nenhum
// valor inventado além do que o SQL realmente lança.
const REMOTE_VISITS_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteVisitsMutationErrorCode>> = {
  forbidden: 'remote_visits_mutation_forbidden',
  seller_required: 'remote_visits_mutation_seller_required',
  seller_not_found: 'remote_visits_mutation_seller_not_found',
  lead_not_found: 'remote_visits_mutation_lead_not_found',
  lead_archived: 'remote_visits_mutation_lead_archived',
  client_name_required: 'remote_visits_mutation_client_name_required',
  invalid_vehicles: 'remote_visits_mutation_invalid_vehicles',
  visit_not_found: 'remote_visits_mutation_visit_not_found',
  visit_closed: 'remote_visits_mutation_visit_closed',
  invalid_status_transition: 'remote_visits_mutation_invalid_status_transition',
  stale_write: 'remote_visits_mutation_stale_write',
};

// Mensagens conceituais para uma futura UI (B4+) — NÃO renderizadas por
// nenhum componente neste lote (B2-B é infraestrutura, sem UI). Mantidas
// aqui, junto do código que as origina, para não divergir quando a UI
// finalmente consumir estes códigos.
export const REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT: Readonly<Record<RemoteVisitsMutationErrorCode, string>> = {
  remote_visits_mutation_forbidden: 'Você não tem permissão para alterar esta visita.',
  remote_visits_mutation_seller_required: 'Selecione um vendedor responsável.',
  remote_visits_mutation_seller_not_found: 'O vendedor selecionado não está disponível.',
  remote_visits_mutation_lead_not_found: 'O cliente vinculado não está disponível.',
  remote_visits_mutation_lead_archived: 'Não é possível agendar uma nova visita para um cliente arquivado.',
  remote_visits_mutation_client_name_required: 'Informe o nome do cliente.',
  remote_visits_mutation_invalid_vehicles: 'Informe pelo menos um veículo válido.',
  remote_visits_mutation_visit_not_found: 'Esta visita não está mais disponível.',
  remote_visits_mutation_visit_closed: 'Esta visita já foi encerrada.',
  remote_visits_mutation_invalid_status_transition: 'Esta ação não é permitida no estado atual da visita.',
  remote_visits_mutation_stale_write: 'Esta visita foi alterada. Os dados foram atualizados.',
  remote_visits_mutation_identity_changed: 'Sua sessão mudou. Tente novamente.',
  remote_visits_mutation_generic_error: 'Não foi possível concluir a ação. Tente novamente.',
};

// Converte um erro cru do Supabase (create_visit/update_visit/
// confirm_visit/cancel_visit/register_visit_result) num RemoteVisitsError
// com código namespaced e detail sanitizado. Mensagem não reconhecida
// SEMPRE vira `remote_visits_mutation_generic_error` — nunca é adivinhada
// como um código específico (sem substring matching amplo).
export function mapRemoteVisitsMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteVisitsError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_VISITS_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteVisitsError(mappedCode ?? 'remote_visits_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Erro LOCAL (nunca vem do backend): lançado pelo generation guard
// (lib/visits/mutationGeneration.ts) quando a geração do cache
// (lib/query/cacheIdentity.ts) muda entre o início e o fim de uma
// mutation — logout, troca de empresa/membership, ou qualquer
// resetQueryCache() em voo.
export function createVisitIdentityChangedMutationError(operation: string): RemoteVisitsError {
  return new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation });
}
