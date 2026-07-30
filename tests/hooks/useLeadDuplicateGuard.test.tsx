// Testes de useLeadDuplicateGuard (M1-E, E4-B2). duplicateCheck (do E4-B1)
// é mockado diretamente — este hook só orquestra debounce/sequence/
// confirmação em cima dele. Cobre: debounce 500ms, guards de enabled/
// telefone, descarte de resposta fora de ordem, confirmação vinculada ao
// telefone, verifyBeforeSubmit (submit sempre re-checa), erro consultivo.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLeadDuplicateGuard, type UseLeadDuplicateGuardOptions } from '@/lib/hooks/useLeadDuplicateGuard';
import type { UseCheckLeadPhoneDuplicateResult } from '@/lib/hooks/useCheckLeadPhoneDuplicate';

function makeDuplicateCheck(overrides: Partial<UseCheckLeadPhoneDuplicateResult> = {}): UseCheckLeadPhoneDuplicateResult {
  return {
    checkDuplicate: vi.fn(),
    getLatestSequence: vi.fn(() => 1),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  };
}

function baseOptions(overrides: Partial<UseLeadDuplicateGuardOptions> = {}): UseLeadDuplicateGuardOptions {
  return {
    phone: '',
    isPhoneValid: false,
    enabled: true,
    identityKey: 'user-1:company-a',
    duplicateCheck: makeDuplicateCheck(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLeadDuplicateGuard — quando NÃO consulta', () => {
  it('telefone vazio: nunca chama checkDuplicate mesmo após o debounce', () => {
    const checkDuplicate = vi.fn();
    renderHook(() => useLeadDuplicateGuard(baseOptions({ duplicateCheck: makeDuplicateCheck({ checkDuplicate }) })));
    vi.advanceTimersByTime(1000);
    expect(checkDuplicate).not.toHaveBeenCalled();
  });

  it('telefone inválido: nunca chama checkDuplicate', () => {
    const checkDuplicate = vi.fn();
    renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '123', isPhoneValid: false, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    vi.advanceTimersByTime(1000);
    expect(checkDuplicate).not.toHaveBeenCalled();
  });

  it('enabled=false (modo local ou sem identidade): nunca chama checkDuplicate', () => {
    const checkDuplicate = vi.fn();
    renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, enabled: false, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    vi.advanceTimersByTime(1000);
    expect(checkDuplicate).not.toHaveBeenCalled();
  });
});

describe('useLeadDuplicateGuard — debounce', () => {
  it('espera 500ms após telefone válido antes de checar', () => {
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows: [] });
    renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    vi.advanceTimersByTime(400);
    expect(checkDuplicate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(checkDuplicate).toHaveBeenCalledWith({ phone: '11999990000', excludeLeadId: undefined });
  });

  it('mudança de telefone antes dos 500ms cancela o debounce anterior', () => {
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '', phoneDigits: '', rows: [] });
    const { rerender } = renderHook(
      (opts: UseLeadDuplicateGuardOptions) => useLeadDuplicateGuard(opts),
      { initialProps: baseOptions({ phone: '11900000001', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }) },
    );
    vi.advanceTimersByTime(300);
    rerender(baseOptions({ phone: '11900000002', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }));
    vi.advanceTimersByTime(300);
    expect(checkDuplicate).not.toHaveBeenCalled();
  });
});

describe('useLeadDuplicateGuard — resultado aplicado', () => {
  it('status/rows refletem o resultado quando sequence e telefone batem', async () => {
    const rows = [{ status: 'accessible' as const, lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true,
      duplicateCheck: makeDuplicateCheck({ checkDuplicate, getLatestSequence: () => 1 }),
    })));
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.status).toBe('checked');
    expect(result.current.rows).toEqual(rows);
    expect(result.current.needsConfirmation).toBe(true);
  });

  it('descarta resposta cujo sequence não é mais o mais recente (fora de ordem)', async () => {
    const rows = [{ status: 'accessible' as const, lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true,
      // getLatestSequence já aponta para uma chamada MAIS NOVA (2) — a
      // resposta desta chamada (sequence 1) deve ser descartada. status
      // permanece 'checking' (nunca reverte para 'idle' sozinho) porque uma
      // chamada mais nova está presumivelmente em voo — é ELA quem vai
      // decidir o próximo estado aplicado.
      duplicateCheck: makeDuplicateCheck({ checkDuplicate, getLatestSequence: () => 2 }),
    })));
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.status).toBe('checking');
    expect(result.current.rows).toEqual([]);
  });

  it('erro no check: status error, needsConfirmation true', async () => {
    const checkDuplicate = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.status).toBe('error');
    expect(result.current.needsConfirmation).toBe(true);
  });
});

describe('useLeadDuplicateGuard — confirmação vinculada ao telefone', () => {
  it('confirm() zera needsConfirmation para o telefone atual', async () => {
    const rows = [{ status: 'restricted' as const, lead_id: null, lead_name: null, lead_archived: null }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.needsConfirmation).toBe(true);
    act(() => { result.current.confirm(); });
    expect(result.current.confirmed).toBe(true);
    expect(result.current.needsConfirmation).toBe(false);
  });

  it('mudar o telefone apaga a confirmação — nova verificação é exigida', async () => {
    const rows = [{ status: 'restricted' as const, lead_id: null, lead_name: null, lead_archived: null }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result, rerender } = renderHook(
      (opts: UseLeadDuplicateGuardOptions) => useLeadDuplicateGuard(opts),
      { initialProps: baseOptions({ phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }) },
    );
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    act(() => { result.current.confirm(); });
    expect(result.current.confirmed).toBe(true);

    rerender(baseOptions({ phone: '11999990001', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }));
    expect(result.current.confirmed).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('mudar a identidade apaga a confirmação e o resultado', async () => {
    const rows = [{ status: 'accessible' as const, lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result, rerender } = renderHook(
      (opts: UseLeadDuplicateGuardOptions) => useLeadDuplicateGuard(opts),
      { initialProps: baseOptions({ phone: '11999990000', isPhoneValid: true, identityKey: 'user-1:company-a', duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }) },
    );
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    act(() => { result.current.confirm(); });

    rerender(baseOptions({ phone: '11999990000', isPhoneValid: true, identityKey: 'user-2:company-b', duplicateCheck: makeDuplicateCheck({ checkDuplicate }) }));
    expect(result.current.confirmed).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(result.current.status).toBe('idle');
  });
});

describe('useLeadDuplicateGuard — verifyBeforeSubmit', () => {
  it('sem duplicado: proceed', async () => {
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows: [] });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    let outcome: string = '';
    await act(async () => { outcome = await result.current.verifyBeforeSubmit(); });
    expect(outcome).toBe('proceed');
    expect(checkDuplicate).toHaveBeenCalled();
  });

  it('duplicado e ainda não confirmado: needs_confirmation, nunca prossegue sozinho', async () => {
    const rows = [{ status: 'accessible' as const, lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    let outcome: string = '';
    await act(async () => { outcome = await result.current.verifyBeforeSubmit(); });
    expect(outcome).toBe('needs_confirmation');
  });

  it('duplicado mas já confirmado para este telefone: proceed', async () => {
    const rows = [{ status: 'accessible' as const, lead_id: 'l1', lead_name: 'Ana', lead_archived: false }];
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    act(() => { result.current.confirm(); });
    let outcome: string = '';
    await act(async () => { outcome = await result.current.verifyBeforeSubmit(); });
    expect(outcome).toBe('proceed');
  });

  it('check falha e nunca foi confirmado: check_failed', async () => {
    const checkDuplicate = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    let outcome: string = '';
    await act(async () => { outcome = await result.current.verifyBeforeSubmit(); });
    expect(outcome).toBe('check_failed');
  });

  it('check falha de novo mas já havia confirmação para este telefone: proceed (check é consultivo)', async () => {
    const checkDuplicate = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    act(() => { result.current.confirm(); });
    let outcome: string = '';
    await act(async () => { outcome = await result.current.verifyBeforeSubmit(); });
    expect(outcome).toBe('proceed');
  });

  it('excludeLeadId é repassado ao checkDuplicate (edição)', async () => {
    const checkDuplicate = vi.fn().mockResolvedValue({ sequence: 1, phone: '11999990000', phoneDigits: '11999990000', rows: [] });
    const { result } = renderHook(() => useLeadDuplicateGuard(baseOptions({
      phone: '11999990000', isPhoneValid: true, excludeLeadId: 'lead-9', duplicateCheck: makeDuplicateCheck({ checkDuplicate }),
    })));
    await act(async () => { await result.current.verifyBeforeSubmit(); });
    expect(checkDuplicate).toHaveBeenCalledWith({ phone: '11999990000', excludeLeadId: 'lead-9' });
  });
});
