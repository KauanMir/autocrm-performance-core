// Testes de lib/hooks/useDayBoundaryKey.ts (COMMERCIAL-REMOTE-B1-B2-B3-A).
// Fake timers + vi.setSystemTime (controla `new Date()` globalmente,
// exercitando o caminho DEFAULT real usado por consumidores — não apenas
// um clock injetado). Cobre: timer único por montagem, dayKey correto,
// virada de meia-noite, reagendamento, cleanup e React.StrictMode.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDayBoundaryKey } from '@/lib/hooks/useDayBoundaryKey';
import { startOfLocalDay } from '@/lib/tasks/deriveTaskState';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDayBoundaryKey — montagem', () => {
  it('retorna startOfLocalDay(now) como valor inicial', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 15, 0, 0));
    const { result } = renderHook(() => useDayBoundaryKey());
    expect(result.current).toBe(startOfLocalDay(new Date(2026, 7, 21, 15, 0, 0)).getTime());
  });

  it('agenda exatamente um timer, com delay igual ao tempo até o próximo midnight local', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 22, 0, 0)); // 21/08 22:00 → faltam 2h para meia-noite
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    renderHook(() => useDayBoundaryKey());
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delay = setTimeoutSpy.mock.calls[0][1];
    expect(delay).toBe(2 * 60 * 60 * 1000);
  });
});

describe('useDayBoundaryKey — virada de meia-noite', () => {
  it('dayKey muda exatamente na virada, e o timer é reagendado para o próximo midnight', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 0)); // falta 1 minuto para meia-noite
    const { result } = renderHook(() => useDayBoundaryKey());
    const dayKeyBefore = result.current;
    expect(dayKeyBefore).toBe(startOfLocalDay(new Date(2026, 7, 21)).getTime());

    act(() => {
      vi.setSystemTime(new Date(2026, 7, 22, 0, 0, 1)); // relógio real avança também
      vi.advanceTimersByTime(60 * 1000); // dispara o timeout agendado (1 min)
    });

    expect(result.current).toBe(startOfLocalDay(new Date(2026, 7, 22)).getTime());
    expect(result.current).not.toBe(dayKeyBefore);
  });

  it('após disparar, um NOVO timer é agendado para o midnight seguinte (nunca setInterval/polling)', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 0));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    renderHook(() => useDayBoundaryKey());
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.setSystemTime(new Date(2026, 7, 22, 0, 0, 1));
      vi.advanceTimersByTime(60 * 1000);
    });

    // 1 timer inicial + 1 reagendado após o disparo = 2 chamadas de
    // setTimeout no total; setInterval NUNCA é usado.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    // Segundo agendamento recalculado do zero (~24h, DST-safe por
    // recálculo local, §22) — nunca "timeout anterior + 24h" acumulado.
    const secondDelay = setTimeoutSpy.mock.calls[1][1];
    expect(secondDelay).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(secondDelay).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('antes da meia-noite, dayKey permanece o do dia atual mesmo avançando o relógio parcialmente', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 10, 0, 0));
    const { result } = renderHook(() => useDayBoundaryKey());
    act(() => {
      vi.setSystemTime(new Date(2026, 7, 21, 20, 0, 0));
      vi.advanceTimersByTime(10 * 60 * 60 * 1000); // avança 10h, ainda no mesmo dia
    });
    expect(result.current).toBe(startOfLocalDay(new Date(2026, 7, 21)).getTime());
  });
});

describe('useDayBoundaryKey — cleanup', () => {
  it('unmount limpa o timer pendente (clearTimeout)', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 10, 0, 0));
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useDayBoundaryKey());
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it('re-render comum não cria um segundo timer', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 10, 0, 0));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const { rerender } = renderHook(() => useDayBoundaryKey());
    rerender();
    rerender();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useDayBoundaryKey — clock injetável não recria o timer a cada render', () => {
  it('passar uma nova função `now` a cada render NÃO reinicia o timer (padrão ref, mesmo de notify em useTasksRemoteBridgeLifecycle)', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 10, 0, 0));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const { rerender } = renderHook(
      ({ now }: { now: () => Date }) => useDayBoundaryKey(now),
      { initialProps: { now: () => new Date() } },
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    rerender({ now: () => new Date() }); // nova referência de função
    rerender({ now: () => new Date() });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1); // ainda só o timer inicial
  });

  it('o timer disparado sempre lê o `now` MAIS RECENTE via ref (nunca uma versão obsoleta)', () => {
    const fixedBefore = new Date(2026, 7, 21, 23, 59, 0);
    vi.setSystemTime(fixedBefore);
    let currentNow = fixedBefore;
    const { result, rerender } = renderHook(
      ({ now }: { now: () => Date }) => useDayBoundaryKey(now),
      { initialProps: { now: () => currentNow } },
    );
    expect(result.current).toBe(startOfLocalDay(fixedBefore).getTime());

    const afterMidnight = new Date(2026, 7, 22, 0, 0, 1);
    currentNow = afterMidnight;
    rerender({ now: () => currentNow }); // ref atualizado, MESMO timer continua vivo

    act(() => {
      vi.setSystemTime(afterMidnight);
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current).toBe(startOfLocalDay(afterMidnight).getTime());
  });
});

describe('useDayBoundaryKey — React.StrictMode', () => {
  it('mount/cleanup/remount do Strict Mode não deixa timer vazado', () => {
    vi.setSystemTime(new Date(2026, 7, 21, 10, 0, 0));
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    );
    const { unmount } = renderHook(() => useDayBoundaryKey(), { wrapper });

    // Strict Mode pode montar o efeito duas vezes em dev — o que importa:
    // toda montagem extra tem seu clearTimeout correspondente, e ao final
    // não sobra nenhum timer pendente sem par.
    expect(setTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(clearTimeoutSpy.mock.calls.length).toBe(setTimeoutSpy.mock.calls.length - 1);

    unmount();
    expect(clearTimeoutSpy.mock.calls.length).toBe(setTimeoutSpy.mock.calls.length);
  });
});
