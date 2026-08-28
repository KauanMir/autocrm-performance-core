'use client';
// components/competitionRewards/CompetitionRewardHistorySection.tsx —
// COMPETITION-REWARDS-V1-B3-EXEC §25-§28/§31-§34. Histórico de premiações.
//   - CompetitionRewardHistoryList: render puro (Manager e Seller usam o
//     mesmo). Usa SOMENTE o snapshot (seller_name_snapshot, contagens e
//     reward_amount_cents/reward_text congelados) — nunca reconstrói o
//     prêmio a partir dos tiers atuais (§31), nunca resolve o nome atual
//     por cima do snapshot (§32), nunca recalcula rank (§34).
//   - CompetitionRewardHistorySection: bloco Manager em Ajustes → Competição,
//     abaixo da configuração (§26). Self-contained (chama o hook).
import React from 'react';
import { LCard } from '@/components/ui/kit';
import { useCompetitionRewardHistory } from '@/lib/hooks/useCompetitionRewardHistory';
import { formatMonthLabel } from '@/lib/competitionRewards/monthOptions';
import type { HistoryMonth } from '@/lib/competitionRewards/homeTypes';
import { MEDAL_EMOJI, RewardValue, CompetitionCounts, hasReward } from '@/components/competitionRewards/rewardVisuals';

export function CompetitionRewardHistoryList({ months }: { months: readonly HistoryMonth[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {months.map((month) => {
        const noCompetition = !month.hadCompetition || month.rows.length === 0;
        return (
          <div key={month.competitionMonthId} data-testid={`history-month-${month.monthStart}`}
            style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: noCompetition ? 8 : 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{formatMonthLabel(month.monthStart)}</span>
              {month.title && <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>· {month.title}</span>}
            </div>
            {noCompetition ? (
              <div data-testid={`history-no-competition-${month.monthStart}`} style={{ fontSize: 13, color: 'var(--t-500)' }}>
                Sem competição no período.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {month.rows.map((row) => (
                  <div key={row.sellerId} data-testid={`history-row-${month.monthStart}-${row.rank}`}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span aria-hidden style={{ fontSize: 15, width: 26, textAlign: 'center', flexShrink: 0 }}>
                      {MEDAL_EMOJI[row.rank] ?? `${row.rank}º`}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t-900)' }}>
                        <span style={{ color: 'var(--t-500)', fontWeight: 600 }}>{row.rank}º</span> {row.sellerName}
                      </div>
                      <CompetitionCounts sales={row.saleCount} visits={row.completedVisitCount} appointments={row.scheduledVisitCount} />
                      {hasReward(row.rewardAmountCents, row.rewardText) && (
                        <div style={{ marginTop: 2 }}>
                          <RewardValue amountCents={row.rewardAmountCents} rewardText={row.rewardText} size="sm" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type CompetitionRewardHistorySectionProps = {
  userId: string;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  isSuperAdminContext?: boolean;
};

export function CompetitionRewardHistorySection({
  userId, companyId, membershipRole, isSuperAdminContext = false,
}: CompetitionRewardHistorySectionProps) {
  const state = useCompetitionRewardHistory({
    userId, companyId, membershipRole, userIsActive: true, isSuperAdminContext, active: true,
  });

  return (
    <LCard style={{ maxWidth: 640, marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Histórico de premiações</div>
      <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 16 }}>
        Meses encerrados que tiveram uma premiação publicada.
      </div>

      {state.status === 'loading' && (
        <div data-testid="history-loading" style={{ fontSize: 13.5, color: 'var(--t-500)', padding: '12px 4px' }}>
          Carregando histórico…
        </div>
      )}
      {state.status === 'error' && (
        <div data-testid="history-error" style={{ fontSize: 13.5, color: 'var(--red)', padding: '12px 4px' }}>
          Não foi possível carregar o histórico de premiações.{' '}
          <button type="button" onClick={state.retry}
            style={{ background: 'none', border: 'none', color: 'var(--gold-ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
            Tentar novamente
          </button>
        </div>
      )}
      {(state.status === 'unavailable' || state.status === 'local') && (
        <div data-testid="history-unavailable" style={{ fontSize: 13.5, color: 'var(--t-500)', padding: '12px 4px' }}>
          O histórico não está disponível no momento.
        </div>
      )}
      {state.status === 'ready' && state.months.length === 0 && (
        <div data-testid="history-empty" style={{ fontSize: 13.5, color: 'var(--t-500)', padding: '12px 4px' }}>
          Nenhuma premiação encerrada ainda.
        </div>
      )}
      {state.status === 'ready' && state.months.length > 0 && (
        <CompetitionRewardHistoryList months={state.months} />
      )}
    </LCard>
  );
}
