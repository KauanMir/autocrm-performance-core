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
  // §33 — a competição ATUAL (get_competition_rewards_overview). Nenhum
  // consumidor nesta wave (Home Seller é B3), mas invalidamos por prefixo
  // depois de save/publish para que a authority de B3 nasça fresca. NUNCA
  // invalidar leaderboard — prêmio não altera rank.
  overviewPrefix: (companyId: string) =>
    ['company', requireCompanyId(companyId), 'competition-rewards-overview'] as const,
};
