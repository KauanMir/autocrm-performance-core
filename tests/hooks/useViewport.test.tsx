// tests/hooks/useViewport.test.tsx — MOBILE-RESPONSIVENESS-V1-B1-EXEC §31.
// Cobre os limiares (390/640/767/768/1023/1024/1440), reação a `resize`
// (coalescido por requestAnimationFrame) e cleanup do listener.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  useViewport,
  deriveViewport,
  readViewportWidth,
  SSR_VIEWPORT_WIDTH,
  type ViewportState,
} from '@/lib/hooks/useViewport';

const ORIGINAL_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

afterEach(() => {
  setWidth(ORIGINAL_WIDTH);
});

// jsdom implementa requestAnimationFrame de forma assíncrona — este helper
// espera o frame agendado pelo hook aplicar o setState.
async function flushRaf() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 24));
  });
}

function Probe({ onState }: { onState: (s: ViewportState) => void }) {
  const vp = useViewport();
  onState(vp);
  return <div data-testid="w">{vp.width}</div>;
}

describe('deriveViewport — limiares puros', () => {
  const cases: Array<[number, Partial<ViewportState>]> = [
    [390, { isSm: false, isMd: false, isLg: false, isDesktop: false }],
    [639, { isSm: false, isMd: false, isLg: false, isDesktop: false }],
    [640, { isSm: true, isMd: false, isLg: false, isDesktop: false }],
    [767, { isSm: true, isMd: false, isLg: false, isDesktop: false }],
    [768, { isSm: true, isMd: true, isLg: false, isDesktop: false }],
    [1023, { isSm: true, isMd: true, isLg: false, isDesktop: false }],
    [1024, { isSm: true, isMd: true, isLg: true, isDesktop: true }],
    [1440, { isSm: true, isMd: true, isLg: true, isDesktop: true }],
  ];
  for (const [w, expected] of cases) {
    it(`${w}px → ${JSON.stringify(expected)}`, () => {
      expect(deriveViewport(w)).toEqual({ width: w, ...expected });
    });
  }
});

describe('readViewportWidth', () => {
  it('lê window.innerWidth quando há window', () => {
    setWidth(812);
    expect(readViewportWidth()).toBe(812);
  });
  it('SSR_VIEWPORT_WIDTH assume desktop', () => {
    expect(deriveViewport(SSR_VIEWPORT_WIDTH).isDesktop).toBe(true);
  });
});

describe('useViewport — hook', () => {
  it('reporta a largura inicial já no primeiro render', () => {
    setWidth(390);
    let seen: ViewportState | null = null;
    render(<Probe onState={(s) => { seen = s; }} />);
    expect(seen!).toMatchObject({ width: 390, isDesktop: false, isMd: false });
  });

  it('reage a resize (coalescido por rAF): 1440 → 390', async () => {
    setWidth(1440);
    const states: ViewportState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    expect(states.at(-1)).toMatchObject({ isDesktop: true });

    setWidth(390);
    act(() => { window.dispatchEvent(new Event('resize')); });
    await flushRaf();
    expect(states.at(-1)).toMatchObject({ width: 390, isDesktop: false });
  });

  it('reage a resize: 800 → 1024 cruza o limiar desktop', async () => {
    setWidth(800);
    const states: ViewportState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    expect(states.at(-1)).toMatchObject({ isDesktop: false });

    setWidth(1024);
    act(() => { window.dispatchEvent(new Event('resize')); });
    await flushRaf();
    expect(states.at(-1)).toMatchObject({ width: 1024, isDesktop: true });
  });

  it('remove o listener de resize no unmount (cleanup)', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    setWidth(1000);
    const { unmount } = render(<Probe onState={() => {}} />);
    const added = addSpy.mock.calls.filter(([e]) => e === 'resize').length;
    expect(added).toBeGreaterThanOrEqual(1);
    unmount();
    const removed = removeSpy.mock.calls.filter(([e]) => e === 'resize').length;
    expect(removed).toBe(added);
  });

  it('após unmount, um resize não lança nem atualiza estado', async () => {
    setWidth(1000);
    const states: ViewportState[] = [];
    const { unmount } = render(<Probe onState={(s) => states.push(s)} />);
    const countAtUnmount = states.length;
    unmount();
    setWidth(400);
    act(() => { window.dispatchEvent(new Event('resize')); });
    await flushRaf();
    expect(states.length).toBe(countAtUnmount);
  });
});
