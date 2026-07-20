// lib/leads/errors.ts — erros tipados do caminho remoto de leads (M1-E, E3).
// Padrão: mensagens/códigos ESTÁVEIS (como REORDER_LOCAL_ERRORS do M1-D),
// nunca exibidos crus ao usuário; a causa técnica fica em `detail`, já
// higienizada — nunca token, credencial, URL ou query completa.
import type { LeadAdapterError } from '@/lib/leads/adapter';

// Exatamente os 4 códigos do contrato aprovado do E3 — nenhum código extra.
export type RemoteLeadsErrorCode =
  // Falha de rede/RLS/Postgres na leitura remota.
  | 'remote_leads_fetch_failed'
  // Flag ON mas o espelho remoto não está disponível PARA A IDENTIDADE atual
  // (bridge não montado, primeira carga, erro remoto ou troca de usuário/
  // empresa). Nunca há fallback para o snapshot de outra identidade.
  | 'remote_leads_snapshot_unavailable'
  // Mutation local de leads bloqueada em modo remoto (mutations remotas
  // chegam nas fases E4+; nenhuma RPC é chamada no E3).
  | 'remote_leads_read_only'
  // Contexto inválido para o modo remoto: sem sessão/companyId OU dados
  // remotos incompatíveis com a configuração (stage/seller órfão no adapter —
  // LeadAdapterError preservado como causa técnica em detail.adapterError).
  | 'remote_leads_invalid_context';

// Causa técnica segura de um erro do Supabase: somente código e mensagem.
export interface RemoteLeadsErrorDetail {
  code?: string;
  message?: string;
  adapterError?: LeadAdapterError;
  operation?: string;
}

export class RemoteLeadsError extends Error {
  readonly code: RemoteLeadsErrorCode;
  readonly detail: RemoteLeadsErrorDetail;

  constructor(code: RemoteLeadsErrorCode, detail: RemoteLeadsErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (mesmo modelo do reorder M1-D).
    super(code);
    this.name = 'RemoteLeadsError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteLeadsError(error: unknown): error is RemoteLeadsError {
  return error instanceof RemoteLeadsError;
}
