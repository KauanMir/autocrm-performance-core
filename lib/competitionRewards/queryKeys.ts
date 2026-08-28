// lib/competitionRewards/queryKeys.ts — COMPETITION-REWARDS-V1-B2-EXEC
// §32/§33. Query keys da configuração de premiação. Mesmo padrão dos
// domínios irmãos: partição SEMPRE por companyId (cache de empresa A e B
// nunca se cruzam) + month_start (cada mês é uma consulta independente). A
// key não carrega role/token — não é prova de autorização (RPC + RLS
// decidem). Troca de identidade é responsabilidade de
// lib/query/resetQueryCache.ts, nunca da key.

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('competitionRewardQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const competitionRewardQueryKeys = {
  // Editor de configuração de UM mês (get_competition_reward_campaign).
  campaign: (companyId: string, monthStart: string) =>
    ['company', requireCompanyId(companyId), 'competition-reward-campaign', monthStart] as const,
  // Prefixo estável (todos os meses) — invalidateQueries casa por prefixo.
  campaignPrefix: (companyId: string) =>
    ['company', requireCompanyId(companyId), 'competition-reward-campaign'] as const,
  // §33 (B2) / §37/§38 (B3) — a competição ATUAL
  // (get_competition_rewards_overview). B2 invalida por PREFIXO depois de
  // save/publish; B3 lê sob `overview` (mesmo prefixo, então a invalidação
  // de B2 continua pegando) e o acknowledge invalida o prefixo de novo.
  // NUNCA invalidar leaderboard — prêmio não altera rank.
  overviewPrefix: (companyId: string) =>
    ['company', requireCompanyId(companyId), 'competition-rewards-overview'] as const,
  overview: (companyId: string, userId: string) =>
    ['company', requireCompanyId(companyId), 'competition-rewards-overview', 'v1', userId] as const,
  // Histórico de premiações (list_competition_reward_history) — lazy/on-demand.
  history: (companyId: string, userId: string, limit: number) =>
    ['company', requireCompanyId(companyId), 'competition-reward-history', 'v1', userId, limit] as const,
};
