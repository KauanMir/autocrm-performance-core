// lib/tasks/errors.ts — erros tipados do caminho remoto de Tasks
// (COMMERCIAL-REMOTE-B1-B2-A). Mesmo padrão de lib/leads/errors.ts:
// mensagens/códigos ESTÁVEIS, nunca exibidos crus ao usuário; a causa
// técnica fica em `detail`, já higienizada — nunca token, credencial, URL
// ou query completa.
import type { TaskAdapterError } from '@/lib/tasks/taskAdapter';

export type RemoteTasksErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_tasks_fetch_failed'
  // Flag/mode remote_ready mas o espelho remoto não está disponível PARA A
  // IDENTIDADE atual (bridge não montado, primeira carga, erro remoto ou
  // troca de usuário/empresa). Nunca há fallback para o snapshot de outra
  // identidade.
  | 'remote_tasks_snapshot_unavailable'
  // Contexto inválido para o modo remoto: sem sessão/companyId OU dados
  // remotos incompatíveis com a configuração (Seller ausente do catálogo —
  // TaskAdapterError preservado como causa técnica em detail.adapterError).
  | 'remote_tasks_invalid_context'
  | RemoteTasksMutationErrorCode;

// Códigos das mutations (create_task/update_task/complete_task) — mapeados
// EXATAMENTE a partir das mensagens estáveis que as RPCs lançam
// (`raise exception '<codigo>'`, supabase/migrations/
// 20260819100000_commercial_remote_b1_tasks.sql, reconfirmado sem depender
// de memória no B1-B2-A-EXEC §2) — nunca um código inventado além do que o
// SQL realmente lança. `identity_changed` é o único código desta lista que
// NUNCA vem do backend: é lançado localmente pelos hooks (B1-B2-C) quando a
// geração do cache muda entre o início e o fim da mutation (logout/troca de
// empresa/membership em voo). `generic_error` é o fallback seguro para
// qualquer mensagem não reconhecida — nunca uma mensagem desconhecida vira
// `stale_write`/`forbidden`/qualquer outro código específico por adivinhação.
export type RemoteTasksMutationErrorCode =
  | 'remote_tasks_mutation_forbidden'
  | 'remote_tasks_mutation_seller_required'
  | 'remote_tasks_mutation_seller_not_found'
  | 'remote_tasks_mutation_lead_not_found'
  | 'remote_tasks_mutation_invalid_title'
  | 'remote_tasks_mutation_task_not_found'
  | 'remote_tasks_mutation_task_completed'
  | 'remote_tasks_mutation_already_completed'
  | 'remote_tasks_mutation_stale_write'
  | 'remote_tasks_mutation_identity_changed'
  | 'remote_tasks_mutation_generic_error';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteTasksErrorDetail {
  code?: string;
  message?: string;
  adapterError?: TaskAdapterError;
  operation?: string;
}

export class RemoteTasksError extends Error {
  readonly code: RemoteTasksErrorCode;
  readonly detail: RemoteTasksErrorDetail;

  constructor(code: RemoteTasksErrorCode, detail: RemoteTasksErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (mesmo modelo de RemoteLeadsError).
    super(code);
    this.name = 'RemoteTasksError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteTasksError(error: unknown): error is RemoteTasksError {
  return error instanceof RemoteTasksError;
}

// Mapa mensagem-estável -> código namespaced. Espelha EXATAMENTE as 9
// mensagens de `raise exception` confirmadas na migration #51 — nenhum
// valor inventado além do que o SQL realmente lança.
const REMOTE_TASKS_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteTasksMutationErrorCode>> = {
  forbidden: 'remote_tasks_mutation_forbidden',
  seller_required: 'remote_tasks_mutation_seller_required',
  seller_not_found: 'remote_tasks_mutation_seller_not_found',
  lead_not_found: 'remote_tasks_mutation_lead_not_found',
  invalid_title: 'remote_tasks_mutation_invalid_title',
  task_not_found: 'remote_tasks_mutation_task_not_found',
  task_completed: 'remote_tasks_mutation_task_completed',
  already_completed: 'remote_tasks_mutation_already_completed',
  stale_write: 'remote_tasks_mutation_stale_write',
};

// Converte um erro cru do Supabase (create_task/update_task/complete_task)
// num RemoteTasksError com código namespaced e detail sanitizado. Mensagem
// não reconhecida SEMPRE vira `remote_tasks_mutation_generic_error` — nunca
// é adivinhada como um código específico (sem substring matching amplo).
export function mapRemoteTasksMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteTasksError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_TASKS_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteTasksError(mappedCode ?? 'remote_tasks_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Erro LOCAL (nunca vem do backend): lançado pelos hooks de mutation (B1-
// B2-C) quando a geração do cache (lib/query/cacheIdentity.ts) muda entre o
// início e o fim de uma mutation — logout, troca de empresa/membership, ou
// qualquer resetQueryCache() em voo.
export function createTaskIdentityChangedMutationError(operation: string): RemoteTasksError {
  return new RemoteTasksError('remote_tasks_mutation_identity_changed', { operation });
}
