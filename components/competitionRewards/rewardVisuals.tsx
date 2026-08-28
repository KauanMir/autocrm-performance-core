'use client';
// components/competitionRewards/rewardVisuals.tsx —
// COMPETITION-REWARDS-V1-B3-EXEC. Peças visuais compartilhadas entre a
// Home (Seller/Manager) e o histórico (Ajustes). Currency SEMPRE via
// formatCentsToBRL (§43, nunca um formatter novo). Design: competitivo +
// profissional + medalha/dourado com moderação — sem cassino/neon/glow
// (§7).
import React from 'react';
import { formatCentsToBRL } from '@/lib/deals/money';
import { monthName } from '@/lib/competitionRewards/monthOptions';

export const MEDAL_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function ordinal(position: number): string {
  return `${position}º lugar`;
}

// Título da campanha OU fallback "Prêmios de {Mês}" (§44) — nunca "null".
export function campaignHeading(title: string | null, monthStart: string | null): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  const name = monthStart ? monthName(monthStart) : '';
  return name ? `Prêmios de ${name}` : 'Prêmios do mês';
}

// Um prêmio (valor / texto / os dois) — NUNCA "R$ 0" nem "sem valor" (§8).
// Retorna null quando não há nada a mostrar (o chamador então omite a linha).
export function RewardValue({
  amountCents, rewardText, size = 'md',
}: {
  amountCents: number | null;
  rewardText: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const hasMoney = amountCents !== null && amountCents > 0;
  const text = rewardText?.trim() ?? '';
  if (!hasMoney && text === '') return null;
  const fs = size === 'lg' ? 15 : size === 'sm' ? 12.5 : 13.5;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, fontSize: fs }}>
      {hasMoney && (
        <span className="tnum" style={{ fontWeight: 700, color: 'var(--gold-ink, #C9A227)' }}>
          {formatCentsToBRL(amountCents as number)}
        </span>
      )}
      {hasMoney && text !== '' && <span style={{ color: 'var(--t-400)' }}>+</span>}
      {text !== '' && <span style={{ fontWeight: 600, color: 'var(--t-800, #ddd)' }}>{text}</span>}
    </span>
  );
}

export function hasReward(amountCents: number | null, rewardText: string | null): boolean {
  return (amountCents !== null && amountCents > 0) || (rewardText?.trim() ?? '') !== '';
}

// Linha/card vertical de uma colocação premiada (§10 — cards verticais, nunca
// N colunas minúsculas). `highlight` marca a posição do próprio Seller.
export function RewardTierRow({
  position, amountCents, rewardText, highlight = false,
}: {
  position: number;
  amountCents: number | null;
  rewardText: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      data-testid={`reward-tier-${position}`}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px',
        borderRadius: 12,
        border: `1px solid ${highlight ? 'var(--gold-line, rgba(201,162,39,.5))' : 'var(--border, #2a2a2a)'}`,
        background: highlight ? 'var(--gold-bg, rgba(201,162,39,.08))' : 'rgba(255,255,255,.02)',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>
        {MEDAL_EMOJI[position] ?? '•'}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-900, #fff)' }}>
          {ordinal(position)}{highlight ? ' · você' : ''}
        </div>
        <RewardValue amountCents={amountCents} rewardText={rewardText} />
      </div>
    </div>
  );
}

// Trio de contagens da Competition V2 (§33 — Vendas/Visitas/Agendamentos,
// nunca pontos).
export function CompetitionCounts({
  sales, visits, appointments,
}: {
  sales: number; visits: number; appointments: number;
}) {
  return (
    <span style={{ fontSize: 12.5, color: 'var(--t-500, #9a9a9a)' }}>
      {sales} {sales === 1 ? 'venda' : 'vendas'} · {visits} {visits === 1 ? 'visita' : 'visitas'} · {appointments} {appointments === 1 ? 'agendamento' : 'agendamentos'}
    </span>
  );
}
