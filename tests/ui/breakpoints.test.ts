// tests/ui/breakpoints.test.ts — MOBILE-RESPONSIVENESS-V1-B1-EXEC §36.
// Decisão pura de gutter por viewport (não depende de layout renderizado
// no jsdom).
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, DESKTOP_MIN_WIDTH, gutterForWidth } from '@/lib/ui/breakpoints';

describe('BREAKPOINTS', () => {
  it('valores alinhados ao Tailwind (sem breakpoint custom)', () => {
    expect(BREAKPOINTS).toEqual({ sm: 640, md: 768, lg: 1024, xl: 1280 });
  });
  it('DESKTOP_MIN_WIDTH === lg', () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1024);
  });
});

describe('gutterForWidth', () => {
  const cases: Array<[number, number]> = [
    [320, 16],
    [390, 16],
    [639, 16],
    [640, 16],
    [767, 16],
    [768, 24],
    [1023, 24],
    [1024, 30],
    [1440, 30],
  ];
  for (const [w, g] of cases) {
    it(`${w}px → ${g}px`, () => {
      expect(gutterForWidth(w)).toBe(g);
    });
  }
});
