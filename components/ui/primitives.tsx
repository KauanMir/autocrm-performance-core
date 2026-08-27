'use client';
// components/ui/primitives.tsx — MOBILE-RESPONSIVENESS-V1-B1-EXEC §22-§25.
// Primitives de layout reutilizáveis. NÃO são consumidos em massa neste
// lote (as telas operacionais são adaptadas em B2-B4) — aqui só existem +
// testes isolados. Mesmo padrão inline-style do resto do app (sem Tailwind,
// A1).
//
// §26 (B1) — DataRow/DataList entraram no B2 (components/ui/DataRow.tsx).
import React from 'react';
import { useViewport } from '@/lib/hooks/useViewport';

type DivProps = {
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
};

// §23 — coluna flex simples.
export function Stack({
  gap = 12,
  align,
  justify,
  style,
  className,
  children,
}: DivProps & {
  gap?: number;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
}) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// §24 — linha flex que SEMPRE quebra (flex-wrap: wrap). Substituirá os
// clusters `nowrap` nas próximas ondas.
export function Cluster({
  gap = 12,
  align = 'center',
  justify,
  style,
  className,
  children,
}: DivProps & {
  gap?: number;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
}) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap,
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// §22 — grid responsiva sem media query: cada trilha tem no mínimo
// `min(minPx, 100%)`, então NUNCA estoura a viewport quando o container é
// mais estreito que `minPx` (correção estrutural dos
// `minmax(340px, 1fr)` do A1). Uso massivo fica para B2/B4.
export function AutoGrid({
  min,
  gap = 16,
  style,
  className,
  children,
}: DivProps & { min: number; gap?: number }) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// MOBILE-RESPONSIVENESS-V1-B3-EXEC §9 — grid de formulário responsiva.
//   < md  → 1 coluna (nunca comprime campos).
//   >= md → `columns` colunas (default 2).
export function FormGrid({ columns = 2, gap = 14, style, className, children }: DivProps & { columns?: number; gap?: number }) {
  const { isMd } = useViewport();
  return (
    <div
      className={className}
      style={{ display: 'grid', gridTemplateColumns: isMd ? `repeat(${columns}, 1fr)` : '1fr', gap, ...style }}
    >
      {children}
    </div>
  );
}

// MOBILE-RESPONSIVENESS-V1-B2-EXEC §7/§11 — fileira de chips/filtros.
//   >= md → quebra organizada (flex-wrap: wrap).
//   < md  → scroller horizontal de uma linha (não esmaga o conteúdo);
//           cada filho não encolhe.
export function ChipRow({ gap = 8, style, className, children }: DivProps & { gap?: number }) {
  const { isMd } = useViewport();
  return (
    <div
      className={className}
      style={
        isMd
          ? { display: 'flex', flexWrap: 'wrap', gap, ...style }
          : {
              display: 'flex', flexWrap: 'nowrap', gap, overflowX: 'auto',
              WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain',
              paddingBottom: 2, ...style,
            }
      }
    >
      {isMd
        ? children
        : React.Children.map(children, (c) =>
            React.isValidElement(c)
              ? <div style={{ flexShrink: 0 }}>{c}</div>
              : c,
          )}
    </div>
  );
}

// §25 — casca de scroll horizontal interno para tabelas/grades largas.
// Afordância visual (fade nas bordas) foi DEFERIDA: a variação de fundo
// entre telas tornava a solução CSS-only frágil o bastante para não caber
// no orçamento de B1 (decisão documentada no relatório). Fica: overflow-x
// controlado, largura contida, scroll suave em touch, e barra fina via a
// classe `.tablescroller` (globals.css).
export function TableScroller({
  style,
  className,
  children,
  ariaLabel,
}: DivProps & { ariaLabel?: string }) {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      className={'tablescroller focus-ring ' + (className || '')}
      style={{
        overflowX: 'auto',
        maxWidth: '100%',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorX: 'contain',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
