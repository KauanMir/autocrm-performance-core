// COMPETITION-REWARDS-V1-B2-EXEC §35 — mapeamento de erro. As mensagens
// cruas espelham `raise ... using message = '...'` de
// upsert_competition_reward_campaign (migration 20260829100000) e
// get_competition_reward_campaign (migration 20260831100000). Nunca
// SQLSTATE / SQL / stack na UI.
import { describe, expect, it } from 'vitest';
import {
  mapCompetitionRewardRpcError,
  getCompetitionRewardErrorMessage,
  CompetitionRewardError,
} from '@/lib/competitionRewards/errors';

describe('mapCompetitionRewardRpcError', () => {
  it('mapeia as mensagens conhecidas do backend', () => {
    const cases: Array<[string, string]> = [
      ['forbidden', 'reward_campaign_forbidden'],
      ['month_closed', 'reward_campaign_month_closed'],
      ['invalid_month', 'reward_campaign_invalid_month'],
      ['invalid_status', 'reward_campaign_invalid_status'],
      ['invalid_title', 'reward_campaign_invalid_title'],
      ['too_many_tiers', 'reward_campaign_too_many_tiers'],
      ['invalid_tier_position', 'reward_campaign_invalid_tier_position'],
      ['duplicate_tier_position', 'reward_campaign_duplicate_tier_position'],
      ['invalid_tier_amount', 'reward_campaign_invalid_tier_amount'],
      ['invalid_tier_text', 'reward_campaign_invalid_tier_text'],
      ['empty_tier', 'reward_campaign_empty_tier'],
      ['unauthenticated', 'reward_campaign_unauthenticated'],
    ];
    for (const [raw, code] of cases) {
      expect(mapCompetitionRewardRpcError({ message: raw }, 'upsert_competition_reward_campaign').code).toBe(code);
    }
  });

  it('mensagem desconhecida → fallback por operação', () => {
    expect(mapCompetitionRewardRpcError({ message: 'pg boom' }, 'get_competition_reward_campaign').code)
      .toBe('reward_campaign_fetch_failed');
    expect(mapCompetitionRewardRpcError({ message: 'pg boom' }, 'upsert_competition_reward_campaign').code)
      .toBe('reward_campaign_mutation_failed');
  });

  it('SQLSTATE fica só no detail, nunca na mensagem exibível', () => {
    const err = mapCompetitionRewardRpcError({ code: '22023', message: 'month_closed' }, 'upsert_competition_reward_campaign');
    expect(err.detail.code).toBe('22023');
    expect(getCompetitionRewardErrorMessage(err)).not.toMatch(/22023|SQLSTATE|raise|function/i);
  });
});

describe('getCompetitionRewardErrorMessage', () => {
  it('cobre os códigos-chave com copy amigável', () => {
    expect(getCompetitionRewardErrorMessage(new CompetitionRewardError('reward_campaign_month_closed')))
      .toBe('Este mês já foi encerrado e não pode mais ser editado.');
    expect(getCompetitionRewardErrorMessage(new CompetitionRewardError('reward_campaign_forbidden')))
      .toMatch(/permissão/);
    expect(getCompetitionRewardErrorMessage(new CompetitionRewardError('reward_campaign_empty_tier')))
      .toMatch(/valor ou de um prêmio/);
    expect(getCompetitionRewardErrorMessage(new CompetitionRewardError('reward_campaign_invalid_tier_amount')))
      .toMatch(/maior que zero/);
    expect(getCompetitionRewardErrorMessage(new CompetitionRewardError('reward_campaign_too_many_tiers')))
      .toMatch(/10 colocações/);
  });

  it('erro não tipado → mensagem genérica segura', () => {
    expect(getCompetitionRewardErrorMessage(new Error('kaboom'))).toBe('Não foi possível salvar a premiação. Tente novamente.');
  });
});
