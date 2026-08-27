// tests/screens/resultsColumnsForWidth.test.ts
// MOBILE-RESPONSIVENESS-V1-B1-EXEC §4 — o helper puro que substituiu o
// `useColumns` ad-hoc de ManagementResults. Limiares 980/640 PRESERVADOS.
import { describe, expect, it } from 'vitest';
import { resultsColumnsForWidth } from '@/components/screens/ManagementResults';

describe('resultsColumnsForWidth — limiares 980/640 preservados', () => {
  const cases: Array<[number, number]> = [
    [390, 1],
    [639, 1],
    [640, 2],
    [979, 2],
    [980, 3],
    [1024, 3],
    [1440, 3],
  ];
  for (const [w, c] of cases) {
    it(`${w}px → ${c} coluna(s)`, () => {
      expect(resultsColumnsForWidth(w)).toBe(c);
    });
  }
});
