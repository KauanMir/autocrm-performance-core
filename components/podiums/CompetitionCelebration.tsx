'use client';
// components/podiums/CompetitionCelebration.tsx — PODIUM-COMPETITION-R2B-B1-EXEC
// §28/§29. Casca visual extraída do passo "done" local de
// FlowRegistrarVenda (components/flows/Flows2.tsx) — Confetti, anéis de
// burst, círculo dourado com troféu — reaproveitada, nunca recriada do
// zero. Diferença deliberada: SOMENTE `saleCount`/`newRank` reais (§28 —
// "ZERO SellerService") e headline/message vindos de
// buildCompetitionCelebration (lib/podium/competitionCelebration.ts,
// fatos estruturados -> copy, nunca texto persistido no banco). Sem o
// pill "gap p/ Top 3" do local (não faz parte do contrato do evento real)
// e sem "Registrar outra venda" (ação só fazia sentido dentro do fluxo de
// venda local) — um único botão de dismiss, usado tanto logo após a
// própria venda quanto no load da Home com evento pendente (§22 do EXEC).
import { Icon } from '@/components/ui/Icon';
import { LBtn, Confetti } from '@/components/ui/kit';
import type { CompetitionCelebrationCopy } from '@/lib/podium/competitionCelebration';

export interface CompetitionCelebrationProps {
  copy: CompetitionCelebrationCopy;
  newRank: number;
  saleCount: number;
  onDismiss: () => void;
  dismissLabel?: string;
}

export function CompetitionCelebration({
  copy, newRank, saleCount, onDismiss, dismissLabel = 'Continuar',
}: CompetitionCelebrationProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 80% at 50% -10%, #2a2208, #0a0a0b 60%)', animation: 'flowIn .34s' }}>
      <Confetti />
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .25, pointerEvents: 'none' }} />
      <button onClick={onDismiss} style={{ position: 'absolute', top: 22, right: 26, width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-500)', zIndex: 2 }}>
        <Icon name="x" size={20} stroke={2.2} />
      </button>
      <div style={{ position: 'relative', flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 28 }}>
        <div>
          <div style={{ position: 'relative', width: 150, height: 150, margin: '0 auto 28px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out .3s' }} />
            <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #E8CE72, #A9831F)', display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: '0 24px 64px -16px rgba(212,175,55,.8)', animation: 'goldPulse 3s ease-in-out infinite' }}>
              <Icon name="trophy" size={68} stroke={1.9} />
            </div>
          </div>
          <div className="display" style={{ fontSize: 13, fontWeight: 800, color: '#E8CE72', letterSpacing: '.28em', marginBottom: 10 }}>{copy.eyebrow}</div>
          <h1 className="display" style={{ margin: '0 0 14px', fontSize: 46, fontWeight: 900, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>{copy.headline}</h1>
          <p style={{ margin: '0 auto 24px', color: 'var(--txt-mid)', fontSize: 16, maxWidth: 500 }}>{copy.message}</p>
          <div style={{ display: 'inline-flex', gap: 14, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ padding: '16px 26px', borderRadius: 16, background: 'linear-gradient(180deg,#1f1a08,#141103)', border: '1px solid rgba(212,175,55,.4)' }}>
              <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#E8CE72', lineHeight: 1 }}>{saleCount}</div>
              <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>vendas no mês</div>
            </div>
            <div style={{ padding: '16px 26px', borderRadius: 16, background: 'rgba(255,255,255,.04)', border: '1px solid var(--line-dark)' }}>
              <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{newRank}º</div>
              <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>posição</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <LBtn kind="gold" size="lg" icon="check" onClick={onDismiss}>{dismissLabel}</LBtn>
          </div>
        </div>
      </div>
    </div>
  );
}
