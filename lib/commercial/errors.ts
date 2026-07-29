// lib/commercial/errors.ts — erros tipados da leitura comercial do Super
// Admin (M1-F S8-C2-B2). Mesmo padrão de lib/leads/errors.ts e
// lib/companies/errors.ts: código/mensagem ESTÁVEIS, nunca exibidos crus ao
// usuário (SQLSTATE/mensagem do PostgREST ficam só em `detail`, já
// higienizado — nunca token, credencial, URL ou query completa).

export type PlatformCommercialErrorCode =
  | 'platform_commercial_companies_fetch_failed'
  | 'platform_commercial_leads_fetch_failed'
  | 'platform_commercial_timeline_fetch_failed'
  | 'platform_commercial_stages_fetch_failed'
  // M1-F S8-C2-C2 — mutation/Sellers/duplicidade.
  | 'platform_commercial_sellers_fetch_failed'
  | 'platform_commercial_lead_create_failed'
  | 'platform_commercial_lead_update_failed'
  | 'platform_commercial_duplicate_check_failed'
  // M1-F S8-C2-D2 — mutations restantes (move/event/assign/archive/
  // unarchive/timeline).
  | 'platform_commercial_lead_move_failed'
  | 'platform_commercial_lead_event_failed'
  | 'platform_commercial_lead_assign_failed'
  | 'platform_commercial_lead_archive_failed'
  | 'platform_commercial_lead_unarchive_failed'
  | 'platform_commercial_lead_timeline_add_failed'
  // Espelham os erros estáveis das 4 RPCs (forbidden/company_required/
  // company_not_found/lead_required/lead_not_found) — nunca inventados aqui,
  // só repassados como causa técnica em `detail.message`.
  | 'platform_commercial_forbidden'
  | 'platform_commercial_company_required';

export interface PlatformCommercialErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class PlatformCommercialError extends Error {
  readonly code: PlatformCommercialErrorCode;
  readonly detail: PlatformCommercialErrorDetail;

  constructor(code: PlatformCommercialErrorCode, detail: PlatformCommercialErrorDetail = {}) {
    super(code);
    this.name = 'PlatformCommercialError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPlatformCommercialError(error: unknown): error is PlatformCommercialError {
  return error instanceof PlatformCommercialError;
}

// Erros LOCAIS (pré-RPC) dos hooks de mutation platform — literais
// duplicados de propósito (CREATE_PLATFORM_LEAD_LOCAL_ERRORS/
// UPDATE_PLATFORM_LEAD_LOCAL_ERRORS, em lib/hooks/) para manter este
// tradutor centralizado sem inverter a dependência hooks -> commercial.
const LOCAL_ERROR_MESSAGES: Record<string, string> = {
  'create-platform-lead-not-allowed': 'Você não tem permissão para criar Leads nesta empresa.',
  'create-platform-lead-stale-context': 'A empresa selecionada mudou antes da conclusão. Tente novamente.',
  'update-platform-lead-not-allowed': 'Você não tem permissão para editar Leads nesta empresa.',
  'update-platform-lead-stale-context': 'A empresa selecionada mudou antes da conclusão. Tente novamente.',
  // M1-F S8-C2-D2 — mesmas duas mensagens locais, reaplicadas às seis
  // mutations restantes (nunca uma nova mensagem por RPC — o motivo local é
  // sempre um dos dois: falta de autorização ou contexto obsoleto).
  'move-platform-lead-not-allowed': 'Você não tem permissão para mover Leads nesta empresa.',
  'move-platform-lead-stale-context': 'O contexto da empresa mudou. Tente novamente.',
  'apply-platform-lead-event-not-allowed': 'Você não tem permissão para registrar eventos nesta empresa.',
  'apply-platform-lead-event-stale-context': 'O contexto da empresa mudou. Tente novamente.',
  'assign-platform-lead-seller-not-allowed': 'Você não tem permissão para atribuir vendedores nesta empresa.',
  'assign-platform-lead-seller-stale-context': 'O contexto da empresa mudou. Tente novamente.',
  'archive-platform-lead-not-allowed': 'Você não tem permissão para arquivar Leads nesta empresa.',
  'archive-platform-lead-stale-context': 'O contexto da empresa mudou. Tente novamente.',
  'unarchive-platform-lead-not-allowed': 'Você não tem permissão para desarquivar Leads nesta empresa.',
  'unarchive-platform-lead-stale-context': 'O contexto da empresa mudou. Tente novamente.',
  'add-platform-lead-timeline-entry-not-allowed': 'Você não tem permissão para adicionar entradas nesta empresa.',
  'add-platform-lead-timeline-entry-stale-context': 'O contexto da empresa mudou. Tente novamente.',
};

// M1-F S8-C2-C2 — tradutor único dos códigos estáveis das RPCs de mutation/
// Sellers/duplicidade (create_lead/update_lead/check_lead_phone_duplicate/
// list_platform_sellers_for_company) para mensagens PT-BR simples. Mesmo
// padrão de getReorderStagesErrorMessage (M1-D) — nenhum componente compara
// `detail.message` bruto diretamente; tudo passa por aqui. Nunca expõe SQL,
// UUID ou stack.
export function getPlatformCommercialErrorMessage(error: unknown): string {
  const localMessage = !isPlatformCommercialError(error) && typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : '';
  if (localMessage in LOCAL_ERROR_MESSAGES) {
    return LOCAL_ERROR_MESSAGES[localMessage];
  }

  const message = isPlatformCommercialError(error) ? error.detail.message ?? '' : '';

  switch (message) {
    case 'company_required':
      return 'Selecione uma empresa.';
    case 'company_not_found':
      return 'Esta empresa não foi encontrada.';
    case 'company_read_only':
      return 'Esta empresa está disponível somente para consulta.';
    case 'forbidden':
      return 'Você não tem permissão para esta ação.';
    case 'initial_stage_missing':
      return 'Esta empresa não possui uma etapa inicial configurada.';
    case 'seller_not_found':
      return 'O vendedor selecionado não está mais disponível.';
    case 'lead_not_found':
      return 'Este Lead não foi encontrado.';
    case 'lead_archived':
      return 'Este Lead está arquivado e não pode ser editado.';
    case 'stale_write':
      return 'Este Lead foi alterado em outro lugar. Abra novamente para editar.';
    case 'invalid_phone':
      return 'Informe um telefone válido.';
    // M1-F S8-C2-D2
    case 'stage_not_found':
      return 'A etapa selecionada não está mais disponível.';
    case 'invalid_event':
      return 'Este evento não é reconhecido pelo sistema.';
    default:
      return 'Não foi possível concluir esta ação.';
  }
}
