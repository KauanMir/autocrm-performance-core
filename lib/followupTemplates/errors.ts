// lib/followupTemplates/errors.ts — erros tipados de Follow-up Templates
// (FOLLOW-UP-TEMPLATES-A3-EXEC). Mesmo padrão de lib/tasks/errors.ts:
// mensagens/códigos ESTÁVEIS mapeados 1:1 a partir do que as RPCs do A2
// (supabase/migrations/20260826110000_followup_templates_a2_backend.sql)
// realmente lançam via `raise exception '<codigo>'` — nunca um código
// inventado além do que o SQL lança. Mensagem não reconhecida sempre vira
// `generic_error`, nunca adivinhada como um código específico.

export type RemoteFollowUpTemplatesErrorCode =
  | 'remote_followup_templates_fetch_failed'
  | RemoteFollowUpTemplatesMutationErrorCode;

export type RemoteFollowUpTemplatesMutationErrorCode =
  | 'remote_followup_templates_mutation_forbidden'
  | 'remote_followup_templates_mutation_company_required'
  | 'remote_followup_templates_mutation_company_not_found'
  | 'remote_followup_templates_mutation_company_read_only'
  | 'remote_followup_templates_mutation_not_found'
  | 'remote_followup_templates_mutation_conflict'
  | 'remote_followup_templates_mutation_limit_reached'
  | 'remote_followup_templates_mutation_invalid_name'
  | 'remote_followup_templates_mutation_invalid_task_title'
  | 'remote_followup_templates_mutation_invalid_offset'
  | 'remote_followup_templates_mutation_invalid_time'
  | 'remote_followup_templates_mutation_reorder_incomplete'
  // Local (nunca vem do backend): geração do cache mudou entre início e fim
  // da mutation (logout/troca de empresa/membership em voo) — mesmo padrão
  // de remote_tasks_mutation_identity_changed.
  | 'remote_followup_templates_mutation_identity_changed'
  | 'remote_followup_templates_mutation_generic_error';

export interface RemoteFollowUpTemplatesErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class RemoteFollowUpTemplatesError extends Error {
  readonly code: RemoteFollowUpTemplatesErrorCode;
  readonly detail: RemoteFollowUpTemplatesErrorDetail;

  constructor(code: RemoteFollowUpTemplatesErrorCode, detail: RemoteFollowUpTemplatesErrorDetail = {}) {
    // message = código estável: nada interno do banco vaza para a UI; quem
    // renderiza traduz o código para PT-BR (getFollowUpTemplateErrorMessage).
    super(code);
    this.name = 'RemoteFollowUpTemplatesError';
    this.code = code;
    this.detail = detail;
  }
}

export function isRemoteFollowUpTemplatesError(error: unknown): error is RemoteFollowUpTemplatesError {
  return error instanceof RemoteFollowUpTemplatesError;
}

// Mapa mensagem-estável -> código namespaced. Espelha EXATAMENTE as
// mensagens de `raise exception` da migration A2 (create_followup_template/
// update_followup_template/set_followup_template_active/
// reorder_followup_templates/resolve_followup_template_mutation_context).
const REMOTE_FOLLOWUP_TEMPLATES_MUTATION_BACKEND_MESSAGE_CODES: Readonly<Record<string, RemoteFollowUpTemplatesMutationErrorCode>> = {
  forbidden: 'remote_followup_templates_mutation_forbidden',
  company_required: 'remote_followup_templates_mutation_company_required',
  company_not_found: 'remote_followup_templates_mutation_company_not_found',
  company_read_only: 'remote_followup_templates_mutation_company_read_only',
  followup_template_not_found: 'remote_followup_templates_mutation_not_found',
  followup_template_conflict: 'remote_followup_templates_mutation_conflict',
  followup_template_limit_reached: 'remote_followup_templates_mutation_limit_reached',
  followup_template_invalid_name: 'remote_followup_templates_mutation_invalid_name',
  followup_template_invalid_task_title: 'remote_followup_templates_mutation_invalid_task_title',
  followup_template_invalid_offset: 'remote_followup_templates_mutation_invalid_offset',
  followup_template_invalid_time: 'remote_followup_templates_mutation_invalid_time',
  followup_template_reorder_incomplete: 'remote_followup_templates_mutation_reorder_incomplete',
};

export function mapRemoteFollowUpTemplatesMutationError(
  error: { code?: unknown; message?: unknown },
  operation: string,
): RemoteFollowUpTemplatesError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mappedCode = rawMessage ? REMOTE_FOLLOWUP_TEMPLATES_MUTATION_BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  return new RemoteFollowUpTemplatesError(mappedCode ?? 'remote_followup_templates_mutation_generic_error', {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

export function createFollowUpTemplateIdentityChangedMutationError(operation: string): RemoteFollowUpTemplatesError {
  return new RemoteFollowUpTemplatesError('remote_followup_templates_mutation_identity_changed', { operation });
}

// Mensagens sanitizadas fixas — nunca SQL cru/SQLSTATE exibido ao usuário
// (precheck A3-EXEC §12). Cobre tanto os erros de leitura (fetch_failed)
// quanto os de mutation.
export function getFollowUpTemplateErrorMessage(error: unknown): string {
  const code = isRemoteFollowUpTemplatesError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_followup_templates_fetch_failed':
      return 'Não foi possível carregar os follow-ups.';
    case 'remote_followup_templates_mutation_forbidden':
      return 'Você não tem permissão para esta ação.';
    case 'remote_followup_templates_mutation_company_required':
    case 'remote_followup_templates_mutation_company_not_found':
      return 'Selecione uma empresa válida.';
    case 'remote_followup_templates_mutation_company_read_only':
      return 'Esta empresa não permite alterações no momento.';
    case 'remote_followup_templates_mutation_not_found':
      return 'Este follow-up não está mais disponível.';
    case 'remote_followup_templates_mutation_conflict':
      return 'Este follow-up foi alterado por outra pessoa. Os dados foram atualizados.';
    case 'remote_followup_templates_mutation_limit_reached':
      return 'Você já possui 12 follow-ups ativos. Desative um deles para ativar outro.';
    case 'remote_followup_templates_mutation_invalid_name':
      return 'Informe um nome válido para o follow-up.';
    case 'remote_followup_templates_mutation_invalid_task_title':
      return 'Informe um título válido para a pendência.';
    case 'remote_followup_templates_mutation_invalid_offset':
      return 'Informe um período válido para o retorno.';
    case 'remote_followup_templates_mutation_invalid_time':
      return 'Informe um horário válido.';
    case 'remote_followup_templates_mutation_reorder_incomplete':
      return 'Não foi possível salvar a nova ordem. Atualize a página e tente novamente.';
    case 'remote_followup_templates_mutation_identity_changed':
      return 'A sessão mudou antes da conclusão da operação.';
    default:
      return 'Não foi possível concluir a ação. Tente novamente.';
  }
}
