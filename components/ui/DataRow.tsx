'use client';
// components/ui/DataRow.tsx — MOBILE-RESPONSIVENESS-V1-B2-EXEC §2/§3/§14.
// Primitive de linha de lista responsiva. NENHUMA regra de negócio aqui —
// só arranjo de layout. Reutilizada por Clientes/Pendências/Visitas/
// Negociações/Vendas/Ranking (B2). Mesmo padrão inline-style do resto do
// app (sem Tailwind).
//
//   >= md  → uma linha horizontal compacta:
//            [leading] [title/subtitle flex:1 minWidth:0] [meta] [status] [actions]
//   < md   → empilhado (2–3 níveis):
//            linha 1: [leading] [title/subtitle flex:1]
//            linha 2: [status] [meta]        (Cluster, quebra)
//            linha 3: [actions]              (largura total)
//
// Prioridade visual mobile (§3): identificação > info operacional > status
// > ações. Nada de nowrap desktop em 390px; nada de fonte ilegível.
import React, { useEffect, useRef, useState } from 'react';
import { useViewport } from '@/lib/hooks/useViewport';
import { Cluster } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

export interface DataRowProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  /** Estilo do contêiner externo (fundo/borda por tom da linha). */
  style?: React.CSSProperties;
  className?: string;
  /** data-testid do contêiner externo. */
  testId?: string;
  /** Gap horizontal desktop (default 14). */
  gap?: number;
  /** Padding do contêiner (default '14px 16px'). */
  pad?: string;
}

const BASE: React.CSSProperties = {
  borderRadius: 11,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
};

export function DataRow({
  leading, title, subtitle, meta, status, actions,
  onClick, style, className, testId, gap = 14, pad = '14px 16px',
}: DataRowProps) {
  const { isMd } = useViewport();
  const clickable = typeof onClick === 'function';

  const titleBlock = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMd ? 'nowrap' : undefined }}>
        {title}
      </div>
      {subtitle != null && (
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2, minWidth: 0 }}>
          {subtitle}
        </div>
      )}
    </div>
  );

  if (isMd) {
    return (
      <div
        data-testid={testId}
        className={className}
        onClick={onClick}
        style={{ ...BASE, display: 'flex', alignItems: 'center', gap, padding: pad, cursor: clickable ? 'pointer' : undefined, ...style }}
      >
        {leading}
        {titleBlock}
        {meta != null && <div style={{ flexShrink: 0 }}>{meta}</div>}
        {status != null && <div style={{ flexShrink: 0 }}>{status}</div>}
        {actions != null && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </div>
    );
  }

  // < md — empilhado
  return (
    <div
      data-testid={testId}
      className={className}
      onClick={onClick}
      style={{ ...BASE, display: 'flex', flexDirection: 'column', gap: 10, padding: pad, cursor: clickable ? 'pointer' : undefined, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {leading}
        {titleBlock}
      </div>
      {(status != null || meta != null) && (
        <Cluster gap={8} style={{ rowGap: 6 }}>
          {status}
          {meta}
        </Cluster>
      )}
      {actions != null && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

// MOBILE-RESPONSIVENESS-V1-B2-EXEC §13/§14 — menu "⋯" para ações
// secundárias de uma linha (ex.: Remarcar/Cancelar de uma Visita quando a
// ação principal já está visível). Primitive pequena e reutilizável;
// viewport-safe (ancorada à direita, largura limitada); ESC e
// clique-fora fecham; itens são <button> focáveis. Sem dependência nova.
export interface RowActionMenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
}

export function RowActionMenu({ items, label = 'Mais ações', align = 'right' }: {
  items: RowActionMenuItem[];
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)', fontSize: 20, fontWeight: 800, lineHeight: 1 }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', zIndex: 30,
            [align]: 0,
            minWidth: 176, maxWidth: 'calc(100vw - 24px)',
            background: 'var(--surface-2, #1d1d20)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 6,
          } as React.CSSProperties}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="focus-ring"
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, textAlign: 'left',
                color: it.tone === 'danger' ? 'var(--red, #FF3B3B)' : 'var(--t-900)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {it.icon && <Icon name={it.icon} size={15} stroke={2.2} style={{ flexShrink: 0 }} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
