'use client';
// lib/hooks/useViewport.ts — MOBILE-RESPONSIVENESS-V1-B1-EXEC §3.
// Hook ÚNICO de viewport do app. Substitui os dois mecanismos ad-hoc
// identificados no A1 (Home.tsx `narrow` e ManagementResults.tsx
// `useColumns`), que duplicavam listener de resize + estado.
//
// Baseado em window.innerWidth (NÃO matchMedia) — mantém compatibilidade
// com o jsdom atual sem precisar de polyfill em tests/setup.ts (§8/§31).
//
// SSR-safe: `readViewportWidth()` devolve um fallback desktop quando não há
// `window`. O shell autenticado nunca chega ao HTML de SSR (o primeiro
// paint é sempre o gate "Carregando…" de App.tsx, client-only), então não
// há risco de mismatch de hidratação para o uso deste lote. Consumidores
// que renderizem no HTML de SSR e dependam da largura real devem tratar o
// primeiro frame como desktop.
import { useEffect, useMemo, useState } from 'react';
import { BREAKPOINTS } from '@/lib/ui/breakpoints';

export interface ViewportState {
  /** Largura atual em px CSS (window.innerWidth), ou o fallback SSR. */
  width: number;
  /** width >= 640 */
  isSm: boolean;
  /** width >= 768 */
  isMd: boolean;
  /** width >= 1024 */
  isLg: boolean;
  /** Alias de isLg — shell desktop (Rail inline de 236px) ativo. */
  isDesktop: boolean;
}

// Fallback quando não há window (SSR / ambiente sem DOM): assume desktop,
// coerente com o markup desktop-first do app.
export const SSR_VIEWPORT_WIDTH = BREAKPOINTS.xl;

export function readViewportWidth(): number {
  if (typeof window === 'undefined' || typeof window.innerWidth !== 'number') {
    return SSR_VIEWPORT_WIDTH;
  }
  return window.innerWidth;
}

export function deriveViewport(width: number): ViewportState {
  return {
    width,
    isSm: width >= BREAKPOINTS.sm,
    isMd: width >= BREAKPOINTS.md,
    isLg: width >= BREAKPOINTS.lg,
    isDesktop: width >= BREAKPOINTS.lg,
  };
}

export function useViewport(): ViewportState {
  const [width, setWidth] = useState<number>(readViewportWidth);

  useEffect(() => {
    let frame = 0;
    const commit = () => {
      frame = 0;
      setWidth(window.innerWidth);
    };
    const onResize = () => {
      // Coalescência leve: no máximo um setState por frame durante um
      // arrasto de resize (§3 — "requestAnimationFrame ou throttle leve").
      if (frame) return;
      frame = window.requestAnimationFrame(commit);
    };
    // Mede uma vez no mount — cobre qualquer divergência entre o valor
    // inicial e a largura real no momento em que o efeito roda.
    setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return useMemo(() => deriveViewport(width), [width]);
}
