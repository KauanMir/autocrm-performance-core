'use client';
// components/competitionRewards/CompetitionRewardsHomeSection.tsx —
// COMPETITION-REWARDS-V1-B3-EXEC. Liga a premiação PUBLICADA à experiência
// real da competição na Home:
//   1. Prêmios do mês (todos os papéis)                       — §5/§15
//   2. Prêmio da posição atual do Seller                      — §11/§42
//   3. Prêmio do 1º lugar                                     — §12
//   4. Card de fechamento do mês anterior + acknowledge       — §17-§24
//   5. Histórico da competição (colapsável, lazy) — Seller    — §29/§30
//
// Autoridade única: useCompetitionRewardsOverview (get_competition_rewards_
// overview). SEM campanha publicada E SEM last_result ⇒ renderiza `null`
// (§3/§41 — a Home fica idêntica a hoje). Draft NUNCA vira bloco de equipe
// (§4). Renderizar isto não dispara nenhuma mutation de negócio (§57).
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useCompetitionRewardsOverview } from '@/lib/hooks/useCompetitionRewardsOverview';
import { useCompetitionRewardHistory } from '@/lib/hooks/useCompetitionRewardHistory';
import { useAcknowledgeCompetitionMonthResult } from '@/lib/hooks/useAcknowledgeCompetitionMonthResult';
import { getCompetitionRewardErrorMessage } from '@/lib/competitionRewards/errors';
import { monthName } from '@/lib/competitionRewards/monthOptions';
import { CompetitionRewardHistoryList } from '@/components/competitionRewards/CompetitionRewardHistorySection';
import {
  RewardTierRow, RewardValue, CompetitionCounts, campaignHeading, hasReward, ordinal,
} from '@/components/competitionRewards/rewardVisuals';
import type { LastResult } from '@/lib/competitionRewards/homeTypes';

export type CompetitionRewardsHomeSectionProps = {
  userId: string;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  isSuperAdminContext?: boolean;
  // Só passado para Manager: link discreto → Ajustes (§45).
  onManageRewards?: () => void;
};

// ── card de fechamento do mês anterior ──────────────────────────────────
function ResultCard({
  result, userId, companyId,
}: {
  result: LastResult;
  userId: string;
  companyId: string | null;
}) {
  const ack = useAcknowledgeCompetitionMonthResult({ userId, companyId, enabled: true });
  const [ackError, setAckError] = useState<string | null>(null);

  const handleAck = async () => {
    setAckError(null);
    try {
      await ack.acknowledge(result.competitionMonthId);
      // sucesso: o overview é invalidado → last_result vira null → o card
      // desmonta sozinho (§22). Nada a esconder otimisticamente aqui.
    } catch (err) {
      setAckError(getCompetitionRewardErrorMessage(err)); // §23 — card permanece
    }
  };

  const showReward = hasReward(result.rewardAmountCents, result.rewardText);

  return (
    <section
      data-testid="reward-result-card"
      aria-label={`Resultado de ${monthName(result.monthStart)}`}
      style={{
        border: '1px solid var(--gold-line, rgba(201,162,39,.5))', borderRadius: 16, padding: 18,
        background: 'linear-gradient(180deg, rgba(201,162,39,.10), rgba(0,0,0,.14))', marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon name="trophy" size={16} stroke={2.2} style={{ color: 'var(--gold-ink, #C9A227)' }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--gold-ink, #C9A227)' }}>
          {monthName(result.monthStart).toUpperCase()} ENCERRADO
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t-900, #fff)', marginBottom: 4 }}>
        Você terminou em {ordinal(result.rank)}.
      </div>
      <CompetitionCounts
        sales={result.saleCount}
        visits={result.completedVisitCount}
        appointments={result.scheduledVisitCount}
      />
      {showReward && (
        <div data-testid="reward-result-prize" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-500)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>
            Prêmio conquistado
          </div>
          <RewardValue amountCents={result.rewardAmountCents} rewardText={result.rewardText} size="lg" />
        </div>
      )}
      {ackError && (
        <div role="alert" data-testid="reward-ack-error" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 10 }}>
          {ackError}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          data-testid="reward-ack-button"
          onClick={handleAck}
          disabled={ack.isPending}
          className="focus-ring"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10,
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: ack.isPending ? 'default' : 'pointer',
            background: 'linear-gradient(180deg,#E8CE72,#C9A227)', color: '#2a2104', border: '1px solid #C9A227',
            opacity: ack.isPending ? 0.6 : 1,
          }}
        >
          {ack.isPending ? 'Confirmando…' : 'Entendi'}
        </button>
      </div>
    </section>
  );
}

// ── histórico colapsável do Seller ─────────────────────────────────────
function SellerRewardHistoryPanel({
  userId, companyId, isSuperAdminContext,
}: {
  userId: string;
  companyId: string | null;
  isSuperAdminContext: boolean;
}) {
  const [open, setOpen] = useState(false);
  const state = useCompetitionRewardHistory({
    userId, companyId, membershipRole: 'seller', userIsActive: true,
    isSuperAdminContext, active: open, limit: 6,
  });

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        data-testid="seller-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
          fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
          background: 'rgba(255,255,255,.03)', color: 'var(--t-500)', border: '1px solid var(--border)',
        }}
      >
        {open ? 'Ocultar histórico' : 'Ver histórico'}
        <Icon name="chevDown" size={14} stroke={2.4} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {state.status === 'loading' && (
            <div data-testid="seller-history-loading" style={{ fontSize: 13, color: 'var(--t-500)' }}>Carregando histórico…</div>
          )}
          {state.status === 'error' && (
            <div data-testid="seller-history-error" style={{ fontSize: 13, color: 'var(--red)' }}>
              Não foi possível carregar o histórico.{' '}
              <button type="button" onClick={state.retry}
                style={{ background: 'none', border: 'none', color: 'var(--gold-ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
                Tentar novamente
              </button>
            </div>
          )}
          {(state.status === 'unavailable' || state.status === 'local') && (
            <div data-testid="seller-history-unavailable" style={{ fontSize: 13, color: 'var(--t-500)' }}>
              O histórico não está disponível no momento.
            </div>
          )}
          {state.status === 'ready' && state.months.length === 0 && (
            <div data-testid="seller-history-empty" style={{ fontSize: 13, color: 'var(--t-500)' }}>
              Nenhuma premiação encerrada ainda.
            </div>
          )}
          {state.status === 'ready' && state.months.length > 0 && (
            <CompetitionRewardHistoryList months={state.months} />
          )}
        </div>
      )}
    </div>
  );
}

// ── seção completa ─────────────────────────────────────────────────────
export function CompetitionRewardsHomeSection({
  userId, companyId, membershipRole, isSuperAdminContext = false, onManageRewards,
}: CompetitionRewardsHomeSectionProps) {
  const state = useCompetitionRewardsOverview({
    userId, companyId, membershipRole, userIsActive: true, isSuperAdminContext,
  });

  // §39/§40 — nunca segura ou quebra a Home. Loading/unavailable ⇒ nada.
  if (state.status === 'error') {
    return (
      <div style={{ marginBottom: 26 }}>
        <div data-testid="reward-section-error" style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
          Não foi possível carregar os prêmios.{' '}
          <button type="button" onClick={state.retry}
            style={{ background: 'none', border: 'none', color: 'var(--gold-ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
  if (state.status !== 'ready') return null;

  const { overview } = state;
  const isSeller = membershipRole === 'seller';
  const isManager = membershipRole === 'manager';

  // §4 — só campanha PUBLICADA vira bloco de equipe na Home.
  const campaign = overview.campaign && overview.campaign.status === 'published' ? overview.campaign : null;
  const showRewardsBlock = campaign !== null && campaign.tiers.length > 0;
  const showResultCard = isSeller && overview.lastResult !== null;

  // §3/§41 — sem nada a mostrar, a Home permanece exatamente como hoje.
  if (!showRewardsBlock && !showResultCard) return null;

  const myRank = overview.myRank;
  // §11/§14 — só quando existe tier para a minha posição (backend só
  // devolve my_reward nesse caso); nunca "Prêmio da sua posição: R$ 0".
  const showMyPositionReward = isSeller && myRank !== null && overview.myReward !== null;
  // §12 — 1º lugar vale X, sobretudo quando não estou em 1º.
  const showFirstPlace = isSeller && overview.firstPlaceReward !== null && myRank !== 1;

  return (
    <div style={{ marginBottom: 26 }}>
      {showResultCard && overview.lastResult && (
        <ResultCard result={overview.lastResult} userId={userId} companyId={companyId} />
      )}

      {showRewardsBlock && campaign && (
        <div data-testid="reward-current-block" style={{ border: '1px solid var(--line-dark, #2a2a2a)', borderRadius: 16, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Icon name="trophy" size={16} stroke={2.2} style={{ color: 'var(--gold-ink, #C9A227)' }} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: 'var(--gold-ink, #C9A227)', textTransform: 'uppercase' }}>
              {campaignHeading(campaign.title, overview.monthStart)}
            </span>
            {isManager && onManageRewards && (
              <button
                type="button"
                data-testid="reward-manage-link"
                onClick={onManageRewards}
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t-500)',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                Gerenciar premiação <Icon name="arrowRight" size={13} stroke={2.4} />
              </button>
            )}
          </div>

          {showMyPositionReward && (
            <div data-testid="reward-my-position" style={{
              border: '1px solid var(--gold-line, rgba(201,162,39,.5))', background: 'var(--gold-bg, rgba(201,162,39,.08))',
              borderRadius: 12, padding: '11px 13px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-ink, #C9A227)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Prêmio da sua posição · {ordinal(myRank as number)}
              </div>
              <div style={{ marginTop: 3 }}>
                <RewardValue amountCents={overview.myReward!.amountCents} rewardText={overview.myReward!.rewardText} size="lg" />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t-400)', marginTop: 5 }}>
                Se a competição terminasse hoje, essa seria sua premiação.
              </div>
            </div>
          )}

          {showFirstPlace && (
            <div data-testid="reward-first-place" style={{ fontSize: 12.5, color: 'var(--t-500)', marginBottom: 12 }}>
              1º lugar vale <RewardValue amountCents={overview.firstPlaceReward!.amountCents} rewardText={overview.firstPlaceReward!.rewardText} size="sm" />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {campaign.tiers.map((tier) => (
              <RewardTierRow
                key={tier.position}
                position={tier.position}
                amountCents={tier.amountCents}
                rewardText={tier.rewardText}
                highlight={isSeller && myRank === tier.position}
              />
            ))}
          </div>

          {isSeller && (
            <SellerRewardHistoryPanel userId={userId} companyId={companyId} isSuperAdminContext={isSuperAdminContext} />
          )}
        </div>
      )}

      {/* Seller sem campanha publicada mas COM resultado pendente: ainda
          oferece o histórico logo abaixo do card de fechamento. */}
      {!showRewardsBlock && showResultCard && isSeller && (
        <SellerRewardHistoryPanel userId={userId} companyId={companyId} isSuperAdminContext={isSuperAdminContext} />
      )}
    </div>
  );
}
