'use client';
// components/podiums/MobilePodium.tsx — MOBILE-RESPONSIVENESS-V1-B4-EXEC
// §5/§6/§45. Apresentação NATIVA do Top 3 em mobile — sem FitBox, sem
// transform:scale, sem altura fixa. Legibilidade + hierarquia + ranking
// correto (row.rank do backend é autoridade; este componente só renderiza
// `top3` na ordem recebida, NUNCA reordena).
//
// Preserva os 3 critérios da Competition V2 (Vendas / Visitas /
// Agendamentos), o badge VOCÊ, o badge SEU ALVO e o movimento ↑N.
// As 4 variantes visuais (A/B/C/D) compartilham esta composição estrutural
// mobile mais simples — o layout mobile não replica pixel a pixel o
// desktop (§7).
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/kit';

const PLACE_RING = ['#E8CE72', '#C0C0C8', '#CD7F32'];

interface PodiumSeller {
  id: string;
  name: string;
  sales?: number;
  visits?: number;
  appointments?: number;
  move?: number;
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  if (typeof value !== 'number') return null;
  return (
    <div style={{ minWidth: 0, textAlign: 'center' }}>
      <div className="display tnum" style={{ fontSize: 17, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function MetricTrio({ s }: { s: PodiumSeller }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-around', width: '100%' }}>
      <Metric label="Vendas" value={s.sales} />
      <Metric label="Visitas" value={s.visits} />
      <Metric label="Agendamentos" value={s.appointments} />
    </div>
  );
}

function MoveArrow({ move }: { move: number | undefined }) {
  if (typeof move !== 'number' || move === 0) return null;
  const up = move > 0;
  return (
    <span title={up ? `Subiu ${move} ${move > 1 ? 'posições' : 'posição'} no mês` : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 800, color: up ? '#27C75F' : '#E23744', flexShrink: 0 }}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} stroke={3} />{Math.abs(move)}
    </span>
  );
}

function Tag({ kind }: { kind: 'me' | 'target' }) {
  const me = kind === 'me';
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '.06em', flexShrink: 0,
      color: me ? '#fff' : '#E8CE72',
      background: me ? '#3B82F6' : 'rgba(212,175,55,.14)',
      border: me ? 'none' : '1px solid rgba(212,175,55,.4)',
      padding: '2px 6px', borderRadius: 999,
    }}>{me ? 'VOCÊ' : 'SEU ALVO'}</span>
  );
}

export function MobilePodium({ top3, period, meId, targetId }: {
  top3: PodiumSeller[];
  period?: string;
  meId?: string | null;
  targetId?: string | null;
}) {
  if (top3.length === 0) return null;
  const [first, ...rest] = top3;

  const card = (s: PodiumSeller, pos: number, primary: boolean) => {
    const ring = PLACE_RING[pos - 1] ?? '#3a3a40';
    const isMe = !!meId && s.id === meId;
    const isTarget = !!targetId && s.id === targetId;
    return (
      <div key={s.id} style={{
        display: 'flex', flexDirection: 'column', gap: primary ? 12 : 9,
        padding: primary ? '16px 16px 18px' : '12px 14px', borderRadius: 16,
        background: primary
          ? 'radial-gradient(120% 90% at 50% 0%, rgba(212,175,55,.12), #16161a 60%)'
          : isMe ? 'linear-gradient(90deg,rgba(59,130,246,.16),rgba(59,130,246,.02))' : 'var(--surface)',
        border: `1px solid ${primary ? 'rgba(212,175,55,.35)' : isMe ? 'rgba(59,130,246,.45)' : 'var(--border)'}`,
        boxShadow: primary ? '0 18px 44px -22px rgba(212,175,55,.4)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <div className="display tnum" style={{ width: 24, textAlign: 'center', fontSize: primary ? 22 : 17, fontWeight: 900, color: ring, flexShrink: 0 }}>{pos}º</div>
          <Avatar name={s.name} size={primary ? 46 : 36} ring={ring} gold={pos === 1} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: primary ? 16 : 14, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              {isMe && <Tag kind="me" />}
              {isTarget && <Tag kind="target" />}
              <MoveArrow move={s.move} />
            </div>
          </div>
        </div>
        <MetricTrio s={s} />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
        <span className="display" style={{ fontSize: 12, fontWeight: 800, color: '#E8CE72', letterSpacing: '.2em' }}>PÓDIO DE CAMPEÕES</span>
        {period && <div style={{ fontSize: 11.5, color: 'var(--txt-mid)', fontWeight: 600, marginTop: 4 }}>{period}</div>}
      </div>
      {card(first, 1, true)}
      {rest.map((s, i) => card(s, i + 2, false))}
    </div>
  );
}
