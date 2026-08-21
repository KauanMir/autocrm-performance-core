// lib/visits/errors.ts — erros tipados do caminho remoto de Visits
// (COMMERCIAL-REMOTE-VISITS-B2-A). Mesmo padrão de lib/tasks/errors.ts:
// mensagens/códigos ESTÁVEIS, nunca exibidos crus ao usuário.
//
// Este lote (B2-A) é READ-ONLY — só o código de erro de leitura existe
// aqui. Os códigos de mutation (remote_visits_mutation_*, mapeados 1:1 a
// partir das mensagens `raise exception '<codigo>'` de create_visit/
// update_visit/confirm_visit/cancel_visit/register_visit_result,
// supabase/migrations/20260821100000_commercial_remote_visits_b1.sql) e
// mapRemoteVisitsMutationError() pertencem ao B2-B — não implementados
// aqui de propósito, para não fabricar um contrato de erro sem nenhuma
// RPC client que o produza ainda.
export type RemoteVisitsErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_visits_fetch_failed';

export interface RemoteVisitsErrorDetail {
  code?: string;
  message?: string;
}

export class RemoteVisitsError extends Error {
  readonly code: RemoteVisitsErrorCode;
  readonly detail: RemoteVisitsErrorDetail;

  constructor(code: RemoteVisitsErrorCode, detail: RemoteVisitsErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI.
    super(code);
    this.name = 'RemoteVisitsError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteVisitsError(error: unknown): error is RemoteVisitsError {
  return error instanceof RemoteVisitsError;
}
