// lib/hooks/useCompetitionRewardCampaign.ts — COMPETITION-REWARDS-V1-B2-EXEC
// §32. Leitura da configuração de premiação de UM mês
// (get_competition_reward_campaign). Mesmo molde de useManagementReport:
// identidade + mês vêm por parâmetro, useQuery SEMPRE chamado na mesma
// ordem (Rules of Hooks), `enabled` fazendo o gating.
//
// Gate de PRODUTO no cliente (§46/§47): SÓ Manager habilita a query — um
// Seller ou Super Admin nunca dispara a RPC, mesmo que a tela seja montada
// por engano. A segurança real continua no backend (a RPC nega Seller/SA
// com 42501); este é o gate de rollout/UX.
import { useQuery } from '@tanstack/react-query';
import { competitionRewardQueryKeys } from '@/lib/competitionRewards/queryKeys';
import { fetchRewardCampaignConfig } from '@/lib/competitionRewards/repository';
import { isCompetitionRewardError } from '@/lib/competitionRewards/errors';
import type { RewardCampaignConfigModel } from '@/lib/competitionRewards/adapter';

export type UseCompetitionRewardCampaignOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
  // 'YYYY-MM-01' do mês selecionado, ou null enquanto o seletor ainda não
  // resolveu.
  monthStart: string | null;
  // Resolvido pelo chamador: canManageCompetitionRewards(currentUser).
  readAuthorized: boolean;
};

export type CompetitionRewardCampaignState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  // A RPC respondeu mas o JSON violou o contrato — estado honesto, nunca
  // uma campanha fabricada (§40).
  | { status: 'contract-error'; retry: () => void }
  | { status: 'ready'; config: RewardCampaignConfigModel };

const DISABLED_QUERY_KEY = ['company', null, 'competition-reward-campaign', null] as const;

export function useCompetitionRewardCampaign(
  options: UseCompetitionRewardCampaignOptions,
): CompetitionRewardCampaignState {
  const { userId, companyId, membershipRole, userIsActive, monthStart, readAuthorized } = options;

  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const hasMonth = typeof monthStart === 'string' && /^\d{4}-\d{2}-01$/.test(monthStart);
  const isManager = membershipRole === 'manager';

  const queryEnabled = readAuthorized && hasUser && hasCompany && userIsActive && isManager && hasMonth;

  const queryKey = hasCompany && hasMonth
    ? competitionRewardQueryKeys.campaign(companyId as string, monthStart as string)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (Seller/SA, sem mês, sem empresa ⇒ enabled=false, zero
  // chamadas) — mesma garantia dos hooks irmãos.
  const query = useQuery<RewardCampaignConfigModel>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => fetchRewardCampaignConfig({ monthStart: monthStart as string }),
  });

  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) {
    if (isCompetitionRewardError(query.error) && query.error.code === 'reward_campaign_contract_invalid') {
      return { status: 'contract-error', retry: query.refetch };
    }
    return { status: 'error', retry: query.refetch };
  }
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', config: query.data };
}
