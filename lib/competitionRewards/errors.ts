// lib/competitionRewards/errors.ts — COMPETITION-REWARDS-V1-B2-EXEC §35.
// Erros tipados da configuração de premiação. Mesmo padrão de
// lib/managementReport/errors.ts / lib/followupTemplates/errors.ts: código
// e mensagem ESTÁVEIS, mapeados 1:1 a partir do que as RPCs realmente
// lançam via `raise ... using message = '<codigo>'` em:
//   supabase/migrations/20260829100000_competition_rewards_v1.sql
//     (upsert_competition_reward_campaign)
//   supabase/migrations/20260831100000_competition_reward_campaign_config_read.sql
//     (get_competition_reward_campaign)
// SQLSTATE, nome de policy, corpo de função e stack NUNCA chegam à UI —
// ficam só em `detail`, e mesmo lá sanitizados pelo PostgREST.

export type CompetitionRewardErrorCode =
  // Rede/RPC (PostgREST devolveu error, ou a chamada rejeitou).
  | 'reward_campaign_fetch_failed'
  | 'reward_campaign_mutation_failed'
  // A RPC respondeu, mas o JSON não bate com o contrato — nunca inventamos
  // uma campanha para preencher o buraco.
  | 'reward_campaign_contract_invalid'
  // Mapeados das mensagens de `raise` das duas RPCs.
  | 'reward_campaign_unauthenticated'
  | 'reward_campaign_forbidden'
  | 'reward_campaign_month_closed'
  | 'reward_campaign_invalid_month'
  | 'reward_campaign_invalid_status'
  | 'reward_campaign_invalid_title'
  | 'reward_campaign_invalid_tiers'
  | 'reward_campaign_too_many_tiers'
  | 'reward_campaign_invalid_tier_position'
  | 'reward_campaign_duplicate_tier_position'
  | 'reward_campaign_invalid_tier_amount'
  | 'reward_campaign_invalid_tier_text'
  | 'reward_campaign_empty_tier'
  // Local (nunca vem do backend): identidade insuficiente no cliente antes
  // de chamar a RPC, ou a geração do cache mudou no meio da mutation.
  | 'reward_campaign_identity_invalid'
  | 'reward_campaign_generic_error';

export interface CompetitionRewardErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class CompetitionRewardError extends Error {
  readonly code: CompetitionRewardErrorCode;
  readonly detail: CompetitionRewardErrorDetail;

  constructor(code: CompetitionRewardErrorCode, detail: CompetitionRewardErrorDetail = {}) {
    super(code);
    this.name = 'CompetitionRewardError';
    this.code = code;
    this.detail = detail;
  }
}

export function isCompetitionRewardError(error: unknown): error is CompetitionRewardError {
  return error instanceof CompetitionRewardError;
}

// Espelha EXATAMENTE as mensagens de `raise ... using message = '...'` das
// duas RPCs. Mensagem não reconhecida vira generic_error, nunca é
// adivinhada como um código específico.
const BACKEND_MESSAGE_CODES: Readonly<Record<string, CompetitionRewardErrorCode>> = {
  unauthenticated: 'reward_campaign_unauthenticated',
  forbidden: 'reward_campaign_forbidden',
  month_closed: 'reward_campaign_month_closed',
  invalid_month: 'reward_campaign_invalid_month',
  invalid_status: 'reward_campaign_invalid_status',
  invalid_title: 'reward_campaign_invalid_title',
  invalid_tiers: 'reward_campaign_invalid_tiers',
  too_many_tiers: 'reward_campaign_too_many_tiers',
  invalid_tier_position: 'reward_campaign_invalid_tier_position',
  duplicate_tier_position: 'reward_campaign_duplicate_tier_position',
  invalid_tier_amount: 'reward_campaign_invalid_tier_amount',
  invalid_tier_text: 'reward_campaign_invalid_tier_text',
  empty_tier: 'reward_campaign_empty_tier',
};

export function mapCompetitionRewardRpcError(
  error: { code?: unknown; message?: unknown },
  operation: 'get_competition_reward_campaign' | 'upsert_competition_reward_campaign',
): CompetitionRewardError {
  const rawMessage = typeof error.message === 'string' ? error.message : undefined;
  const mapped = rawMessage ? BACKEND_MESSAGE_CODES[rawMessage] : undefined;
  const fallback: CompetitionRewardErrorCode = operation === 'get_competition_reward_campaign'
    ? 'reward_campaign_fetch_failed'
    : 'reward_campaign_mutation_failed';
  return new CompetitionRewardError(mapped ?? fallback, {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: rawMessage,
    operation,
  });
}

// Mensagens PT-BR fixas — nunca SQL cru / SQLSTATE / corpo de função (§35).
export function getCompetitionRewardErrorMessage(error: unknown): string {
  const code = isCompetitionRewardError(error) ? error.code : undefined;
  switch (code) {
    case 'reward_campaign_fetch_failed':
      return 'Não foi possível carregar a premiação. Tente novamente.';
    case 'reward_campaign_contract_invalid':
      return 'A premiação retornou em um formato inesperado. Tente novamente mais tarde.';
    case 'reward_campaign_unauthenticated':
    case 'reward_campaign_identity_invalid':
      return 'Sua sessão mudou. Entre novamente para continuar.';
    case 'reward_campaign_forbidden':
      return 'Você não tem permissão para configurar a premiação desta empresa.';
    case 'reward_campaign_month_closed':
      return 'Este mês já foi encerrado e não pode mais ser editado.';
    case 'reward_campaign_invalid_month':
      return 'Selecione um mês válido.';
    case 'reward_campaign_invalid_status':
      return 'Não foi possível salvar a premiação. Tente novamente.';
    case 'reward_campaign_invalid_title':
      return 'O título da campanha pode ter no máximo 120 caracteres.';
    case 'reward_campaign_too_many_tiers':
      return 'A premiação pode ter no máximo 10 colocações.';
    case 'reward_campaign_empty_tier':
      return 'Cada colocação precisa de um valor ou de um prêmio.';
    case 'reward_campaign_invalid_tier_amount':
      return 'Informe um valor maior que zero.';
    case 'reward_campaign_invalid_tier_text':
      return 'O prêmio extra pode ter no máximo 120 caracteres.';
    case 'reward_campaign_invalid_tier_position':
    case 'reward_campaign_duplicate_tier_position':
    case 'reward_campaign_invalid_tiers':
      return 'Não foi possível salvar as colocações. Atualize a página e tente novamente.';
    case 'reward_campaign_mutation_failed':
    case 'reward_campaign_generic_error':
    default:
      return 'Não foi possível salvar a premiação. Tente novamente.';
  }
}
