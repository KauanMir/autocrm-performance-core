// tests/screens/resultsColumnsForWidth.test.ts
// MOBILE-RESPONSIVENESS-V1-B4-EXEC §19 — helper de colunas de Resultados
// consolidado nos breakpoints globais: < sm (640) = 1, sm..lg = 2,
// >= lg (1024) = 3. (Antes, no B1, o limiar superior era 980 ad-hoc.)
import { describe, expect, it } from 'vitest';
import { resultsColumnsForWidth } from '@/components/screens/ManagementResults';

describe('resultsColumnsForWidth — breakpoints globais (sm/lg)', () => {
  const cases: Array<[number, number]> = [
    [390, 1],
    [639, 1],
    [640, 2],
    [979, 2],
    [980, 2],   // banda 980-1023: agora 2 colunas (era 3 no B1)
    [1023, 2],
    [1024, 3],
    [1440, 3],
  ];
  for (const [w, c] of cases) {
    it(`${w}px → ${c} coluna(s)`, () => {
      expect(resultsColumnsForWidth(w)).toBe(c);
    });
  }
});
