// lib/leads/errors.ts — erros tipados do caminho remoto de leads (M1-E, E3).
// Padrão: mensagens/códigos ESTÁVEIS (como REORDER_LOCAL_ERRORS do M1-D),
// nunca exibidos crus ao usuário; a causa técnica fica em `detail`, já
// higienizada — nunca token, credencial, URL ou query completa.
import type { LeadAdapterError } from '@/lib/leads/adapter';

// Exatamente os 4 códigos do contrato aprovado do E3 — nenhum código extra
// aqui; a extensão de mutation (E4-B1) vive em RemoteLeadsMutationErrorCode,
// abaixo, e entra na união por adição, nunca por edição destes 4.
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
  | 'remote_leads_invalid_context'
  | RemoteLeadsMutationErrorCode;

// M1-E E4-B1 — códigos das mutations de create/update/duplicidade
// (create_lead/update_lead/check_lead_phone_duplicate, caminho Manager/
// Seller). Mapeados a partir das mensagens estáveis que as RPCs lançam
// (`raise exception '<codigo>'`, docs/M1-E-DESIGN.md §6) — nunca inventados
// além do que o backend realmente lança. `identity_changed` é o único
// código desta lista que NUNCA vem do backend: é lançado localmente pelos
// hooks quando a geração do cache muda entre o início e o fim da mutation
// (logout/troca de empresa/membership em voo). `generic_error` é o
// fallback seguro para qualquer mensagem não reconhecida — nunca uma
// mensagem desconhecida vira `stale_write`/`forbidden` por adivinhação.
// M1-E E5-A1 — stage_not_found é adicionado de forma aditiva: mensagem real
// lançada por move_lead_to_stage/apply_lead_event quando o stage_id
// enviado (ou o stage_code exigido pelo evento) não pertence à empresa
// resolvida (provado em supabase/tests/04_m1e_move_event.sql e
// 45_m1f_s8c2d1_remaining_mutations.sql). Mensagem PT-BR sanitizada
// reservada para a UI do E5-B1 (Flows2.tsx não é tocado nesta etapa):
// "A etapa selecionada não está mais disponível."
export type RemoteLeadsMutationErrorCode =
  | 'remote_leads_mutation_forbidden'
  | 'remote_leads_mutation_company_required'
  | 'remote_leads_mutation_company_not_found'
  | 'remote_leads_mutation_company_read_only'
  | 'remote_leads_mutation_lead_not_found'
  | 'remote_leads_mutation_lead_archived'
  | 'remote_leads_mutation_seller_not_found'
  | 'remote_leads_mutation_initial_stage_missing'
  | 'remote_leads_mutation_invalid_phone'
  | 'remote_leads_mutation_stage_not_found'
  | 'remote_leads_mutation_stale_write'
  | 'remote_leads_mutation_identity_changed'
  | 'remote_leads_mutation_generic_error';

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

// M1-E E4-B1 — mapa mensagem-estável -> código namespaced. Espelha
// exatamente as mensagens de `raise exception` de create_lead/update_lead/
// check_lead_phone_duplicate e do resolver compartilhado
// resolve_lead_mutation_context (docs/M1-E-DESIGN.md §6, §15.1/§15.3/§15.4)
// — nenhum valor inventado além do que o SQL realmente lança.
const REMOTE_LEADS_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteLeadsMutationErrorCode>> = {
  forbidden: 'remote_leads_mutation_forbidden',
  company_required: 'remote_leads_mutation_company_required',
  company_not_found: 'remote_leads_mutation_company_not_found',
  company_read_only: 'remote_leads_mutation_company_read_only',
  lead_not_found: 'remote_leads_mutation_lead_not_found',
  lead_archived: 'remote_leads_mutation_lead_archived',
  seller_not_found: 'remote_leads_mutation_seller_not_found',
  initial_stage_missing: 'remote_leads_mutation_initial_stage_missing',
  invalid_phone: 'remote_leads_mutation_invalid_phone',
  stage_not_found: 'remote_leads_mutation_stage_not_found',
  stale_write: 'remote_leads_mutation_stale_write',
};

// Converte um erro cru do Supabase (create_lead/update_lead/
// check_lead_phone_duplicate) num RemoteLeadsError com código namespaced e
// detail sanitizado. Mensagem não reconhecida SEMPRE vira
// `remote_leads_mutation_generic_error` — nunca é adivinhada como
// `stale_write`/`forbidden`/qualquer outro código específico.
export function mapRemoteLeadsMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteLeadsError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_LEADS_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteLeadsError(mappedCode ?? 'remote_leads_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Erro LOCAL (nunca vem do backend): lançado pelos hooks de mutation quando
// a geração do cache (lib/query/cacheIdentity.ts) muda entre o início e o
// fim de uma mutation — logout, troca de empresa/membership, ou qualquer
// resetQueryCache() em voo. A escrita já pode ter concluído no servidor;
// este erro só impede que o efeito visual (invalidation, sucesso, fechar
// modal) aterrisse na identidade errada.
export function createIdentityChangedMutationError(operation: string): RemoteLeadsError {
  return new RemoteLeadsError('remote_leads_mutation_identity_changed', { operation });
}
