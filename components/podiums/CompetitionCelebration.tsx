'use client';
// components/podiums/CompetitionCelebration.tsx — PODIUM-COMPETITION-R2B-B1-EXEC
// + COMPETITION-RANKUP-FEEDBACK-V1-EXEC §9-§16/§27/§28. Casca visual
// extraída do passo "done" local de FlowRegistrarVenda
// (components/flows/Flows2.tsx) — Confetti, anéis de burst, círculo dourado
// com troféu — reaproveitada, nunca recriada do zero. headline/message vêm
// de buildCompetitionCelebration (fatos estruturados -> copy, nunca texto
// persistido no banco).
//
// RANKUP-FEEDBACK-V1: quando a venda que causou o avanço tem prêmio
// publicado para a NOVA posição (§9), o card mostra "Prêmio da sua posição"
// + valor/texto, sempre com a ressalva de que ainda não está conquistado
// (§12). Sem tier / sem campanha ⇒ o bloco simplesmente não aparece (§10 —
// nunca "R$ 0"). Quando não há prêmio para a posição mas existe tier de 1º,
// mostra discretamente "1º lugar vale X" (§11). O prêmio vem SEMPRE do
// overview já em cache (resolveCelebrationReward), nunca de tabela nova.
//
// §15/§16 — descartável por "Continuar"/X, sem ack RPC próprio (o caller
// reusa mark_competition_events_seen). §28 — role dialog + heading +
// foco inicial no dismiss + ESC fecha + foco retorna. §27 — nasce
// mobile-safe: headline com clamp e quebra, prêmio com wrap.
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, Confetti } from '@/components/ui/kit';
import { RewardValue } from '@/components/competitionRewards/rewardVisuals';
import type {
  CompetitionCelebrationCopy,
  CelebrationRewardRef,
} from '@/lib/podium/competitionCelebration';

export interface CompetitionCelebrationProps {
  copy: CompetitionCelebrationCopy;
  newRank: number;
  saleCount: number;
  onDismiss: () => void;
  dismissLabel?: string;
  // §9 — prêmio do tier da NOVA posição (já filtrado: só chega quando há
  // valor/texto real). §11 — prêmio do 1º lugar quando a nova posição não é
  // a 1ª. Ambos opcionais: ausência ⇒ o bloco não renderiza (§10).
  reward?: CelebrationRewardRef | null;
  firstPlaceReward?: CelebrationRewardRef | null;
}

export function CompetitionCelebration({
  copy, newRank, saleCount, onDismiss, dismissLabel = 'Continuar', reward = null, firstPlaceReward = null,
}: CompetitionCelebrationProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // §28 — foco inicial sensato + ESC fecha + foco retorna a quem abriu.
  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onDismiss]);

  // §11 — "1º lugar vale X" só quando NÃO há prêmio da própria posição, pra
  // composição não ficar carregada (prioridade: nova posição + seu prêmio).
  const showFirstPlace = !reward && firstPlaceReward !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="competition-celebration-title"
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 80% at 50% -10%, #2a2208, #0a0a0b 60%)', animation: 'flowIn .34s' }}
    >
      <Confetti />
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .25, pointerEvents: 'none' }} />
      <button ref={closeRef} onClick={onDismiss} aria-label="Fechar" style={{ position: 'absolute', top: 22, right: 26, width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-500)', zIndex: 2 }}>
        <Icon name="x" size={20} stroke={2.2} />
      </button>
      <div style={{ position: 'relative', flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 28 }}>
        <div style={{ maxWidth: 520, width: '100%' }}>
          <div style={{ position: 'relative', width: 150, height: 150, margin: '0 auto 28px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out .3s' }} />
            <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #E8CE72, #A9831F)', display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: '0 24px 64px -16px rgba(212,175,55,.8)', animation: 'goldPulse 3s ease-in-out infinite' }}>
              <Icon name="trophy" size={68} stroke={1.9} />
            </div>
          </div>
          <div className="display" style={{ fontSize: 13, fontWeight: 800, color: '#E8CE72', letterSpacing: '.28em', marginBottom: 10 }}>{copy.eyebrow}</div>
          <h1 id="competition-celebration-title" className="display" style={{ margin: '0 0 14px', fontSize: 'clamp(30px, 8vw, 46px)', fontWeight: 900, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.05, maxWidth: '100%', overflowWrap: 'break-word' }}>{copy.headline}</h1>
          <p style={{ margin: '0 auto 24px', color: 'var(--txt-mid)', fontSize: 16, maxWidth: 500, overflowWrap: 'break-word' }}>{copy.message}</p>
          <div style={{ display: 'inline-flex', gap: 14, marginBottom: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ padding: '16px 26px', borderRadius: 16, background: 'linear-gradient(180deg,#1f1a08,#141103)', border: '1px solid rgba(212,175,55,.4)' }}>
              <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#E8CE72', lineHeight: 1 }}>{saleCount}</div>
              <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>vendas no mês</div>
            </div>
            <div style={{ padding: '16px 26px', borderRadius: 16, background: 'rgba(255,255,255,.04)', border: '1px solid var(--line-dark)' }}>
              <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{newRank}º</div>
              <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>posição</div>
            </div>
          </div>

          {reward && (
            <div
              data-testid="celebration-position-reward"
              style={{ margin: '0 auto 22px', maxWidth: 420, padding: '14px 18px', borderRadius: 14, border: '1px solid rgba(212,175,55,.4)', background: 'linear-gradient(180deg,#1f1a08,#141103)' }}
            >
              <div className="display" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.16em', color: '#E8CE72', textTransform: 'uppercase' }}>
                Prêmio da sua posição
              </div>
              <div style={{ marginTop: 6 }}>
                <RewardValue amountCents={reward.amountCents} rewardText={reward.rewardText} size="lg" />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', marginTop: 6 }}>
                Se o mês terminasse agora, essa seria sua premiação.
              </div>
            </div>
          )}

          {showFirstPlace && firstPlaceReward && (
            <div
              data-testid="celebration-first-place"
              style={{ margin: '0 auto 22px', fontSize: 12.5, color: 'var(--txt-lo)', display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' }}
            >
              <span>1º lugar vale</span>
              <RewardValue amountCents={firstPlaceReward.amountCents} rewardText={firstPlaceReward.rewardText} size="sm" />
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <LBtn kind="gold" size="lg" icon="check" onClick={onDismiss}>{dismissLabel}</LBtn>
          </div>
        </div>
      </div>
    </div>
  );
}
