// Testes de RecoverView (components/auth/AuthFlow.tsx) —
// PILOT-P0-A1-EXEC-RECOVERY. Cobre o pedido real de recuperação (antes era
// só setSent(true), mock puro): resetPasswordForEmail chamado com e-mail e
// redirect corretos, loading bloqueia double-submit, sucesso mostra
// mensagem genérica (anti-enumeração), erro real recebe mensagem própria
// sem stack técnica.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => null },
  SellerService: { getAll: () => [] },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { resetPasswordForEmail: m.resetPasswordForEmail } },
  isSupabaseConfigured: true,
}));

import { AuthFlow } from '@/components/auth/AuthFlow';

function renderRecover() {
  return render(<AuthFlow view="recover" setView={vi.fn()} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
}

beforeEach(() => {
  m.resetPasswordForEmail.mockReset();
});

describe('RecoverView — pedido de recuperação', () => {
  it('submit chama resetPasswordForEmail com o e-mail e redirectTo = window.location.origin', async () => {
    m.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    renderRecover();
    fireEvent.change(screen.getByPlaceholderText('voce@empresa.com.br'), { target: { value: 'gerente@loja.com' } });
    fireEvent.click(screen.getByText('Enviar recuperação'));
    await waitFor(() => expect(m.resetPasswordForEmail).toHaveBeenCalledWith('gerente@loja.com', {
      redirectTo: window.location.origin,
    }));
  });

  it('loading impede double submit (resetPasswordForEmail chamado só uma vez em cliques repetidos)', async () => {
    let resolveCall: (v: any) => void = () => {};
    m.resetPasswordForEmail.mockReturnValue(new Promise((resolve) => { resolveCall = resolve; }));
    renderRecover();
    fireEvent.change(screen.getByPlaceholderText('voce@empresa.com.br'), { target: { value: 'gerente@loja.com' } });
    fireEvent.click(screen.getByText('Enviar recuperação'));
    fireEvent.click(screen.getByText('Enviando…'));
    fireEvent.click(screen.getByText('Enviando…'));
    resolveCall({ data: {}, error: null });
    await waitFor(() => expect(screen.getByText('Verifique seu e-mail')).toBeInTheDocument());
    expect(m.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('sucesso mostra mensagem genérica, nunca confirma existência da conta', async () => {
    m.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    renderRecover();
    fireEvent.change(screen.getByPlaceholderText('voce@empresa.com.br'), { target: { value: 'qualquer@x.com' } });
    fireEvent.click(screen.getByText('Enviar recuperação'));
    await waitFor(() => expect(screen.getByText('Verifique seu e-mail')).toBeInTheDocument());
    expect(screen.queryByText(/não encontrad/i)).toBeNull();
    expect(screen.queryByText(/não existe/i)).toBeNull();
  });

  it('erro real (ex.: rate limit) mostra mensagem controlada, nunca a mensagem de sucesso', async () => {
    m.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'Email rate limit exceeded', status: 429 } });
    renderRecover();
    fireEvent.change(screen.getByPlaceholderText('voce@empresa.com.br'), { target: { value: 'gerente@loja.com' } });
    fireEvent.click(screen.getByText('Enviar recuperação'));
    await waitFor(() => expect(screen.getByText('Não foi possível enviar o e-mail agora. Tente novamente em instantes.')).toBeInTheDocument());
    expect(screen.queryByText('Verifique seu e-mail')).toBeNull();
    expect(screen.queryByText(/rate limit/i)).toBeNull();
  });

  it('falha inesperada (exceção) mostra a mesma mensagem controlada, sem crash', async () => {
    m.resetPasswordForEmail.mockRejectedValue(new Error('network down'));
    renderRecover();
    fireEvent.change(screen.getByPlaceholderText('voce@empresa.com.br'), { target: { value: 'gerente@loja.com' } });
    fireEvent.click(screen.getByText('Enviar recuperação'));
    await waitFor(() => expect(screen.getByText('Não foi possível enviar o e-mail agora. Tente novamente em instantes.')).toBeInTheDocument());
    expect(screen.queryByText(/network down/i)).toBeNull();
  });

  it('e-mail vazio: botão não dispara resetPasswordForEmail', () => {
    renderRecover();
    fireEvent.click(screen.getByText('Enviar recuperação'));
    expect(m.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
