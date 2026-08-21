// lib/deals/errors.ts — erros tipados do caminho remoto de Deals
// (COMMERCIAL-REMOTE-DEALS-B2-A read). Mesmo padrão de lib/visits/errors.ts/
// lib/tasks/errors.ts: mensagens/códigos ESTÁVEIS, nunca exibidos crus ao
// usuário; a causa técnica fica em `detail`, já higienizada — nunca token,
// credencial, URL ou query completa.
//
// Somente os códigos de LEITURA existem neste lote — mutations
// (create_deal/update_deal/mark_deal_lost) e o mapeamento de mensagens
// estáveis das RPCs para códigos namespaced ficam para B2-B (mutation
// infra), quando o repository de escrita for construído. Não há mapa de
// mensagem-de-erro-de-RPC aqui — criar essa camada agora, sem nenhum
// caller, seria abstração vazia.
import type { DealAdapterError } from '@/lib/deals/adapter';

export type RemoteDealsErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_deals_fetch_failed'
  // Flag/mode deal_remote_ready mas o dado remoto é inválido para a
  // IDENTIDADE atual (reservado para uso futuro por uma composição de
  // screen-state, mesmo papel de remote_visits_invalid_context/
  // remote_tasks_invalid_context).
  | 'remote_deals_invalid_context';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteDealsErrorDetail {
  code?: string;
  message?: string;
  adapterError?: DealAdapterError;
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
