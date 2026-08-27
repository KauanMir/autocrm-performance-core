// lib/ui/breakpoints.ts — MOBILE-RESPONSIVENESS-V1-B1-EXEC §2.
// Fonte única dos breakpoints do KAPA CRM. Valores alinhados aos defaults
// do Tailwind (sm/md/lg/xl) para que uma eventual migração futura seja
// trivial — mas SEM introduzir Tailwind neste projeto (A1: o app usa
// inline styles; B1 mantém essa arquitetura).
//
// Regra: nenhum novo "magic number" de largura espalhado pelos componentes.
// Quem precisar decidir por viewport consome `useViewport()` (lib/hooks/
// useViewport.ts) ou os helpers abaixo.

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

// Abaixo de `lg` o Rail de 236px deixa de ser inline (vira Drawer) — ver
// components/App.tsx. É o único ponto que decide "mobile shell vs desktop
// shell".
export const DESKTOP_MIN_WIDTH = BREAKPOINTS.lg;

// §19 — gutter horizontal do conteúdo por faixa de viewport.
// mobile 16 · md 24 · lg+ 30. `maxWidth` do conteúdo (1360) é preservado
// por quem aplica o gutter (LightScreen / container-base da Home).
export function gutterForWidth(width: number): number {
  if (width >= BREAKPOINTS.lg) return 30;
  if (width >= BREAKPOINTS.md) return 24;
  return 16;
}
