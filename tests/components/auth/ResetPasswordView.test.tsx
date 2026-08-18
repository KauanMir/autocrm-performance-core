// Testes de ResetPasswordView (components/auth/AuthFlow.tsx) —
// PILOT-P0-A1-EXEC-RECOVERY. Cobre os dois formatos de callback realmente
// suportados (token_hash via query / access_token+refresh_token via hash),
// link inválido/expirado/ausente, limpeza imediata da URL, e o fluxo de
// definição de nova senha (validação, updateUser só com contexto válido,
// sucesso/erro, retorno ao login, sessão de recovery encerrada).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  createTemporaryRecoveryAuthClient: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => null },
  SellerService: { getAll: () => [] },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { resetPasswordForEmail: vi.fn() } },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/auth/temporaryRecoveryAuthClient', () => ({
  createTemporaryRecoveryAuthClient: m.createTemporaryRecoveryAuthClient,
}));

import { AuthFlow } from '@/components/auth/AuthFlow';

function setUrl(pathAndQueryAndHash: string) {
  window.history.pushState(null, '', pathAndQueryAndHash);
}

function renderReset(setView = vi.fn()) {
  const utils = render(<AuthFlow view="reset-password" setView={setView} onAuthed={vi.fn()} onSignedUp={vi.fn()} />);
  return { ...utils, setView };
}

beforeEach(() => {
  m.verifyOtp.mockReset();
  m.setSession.mockReset();
  m.updateUser.mockReset();
  m.signOut.mockReset();
  m.createTemporaryRecoveryAuthClient.mockReset().mockReturnValue({
    auth: { verifyOtp: m.verifyOtp, setSession: m.setSession, updateUser: m.updateUser, signOut: m.signOut },
  });
  window.history.pushState(null, '', '/');
});

describe('ResetPasswordView — callback token_hash (query)', () => {
  it('token_hash + type=recovery válidos: verifyOtp chamado, avança para o formulário de nova senha', async () => {
    setUrl('/?token_hash=abc123&type=recovery');
    m.verifyOtp.mockResolvedValue({ data: {}, error: null });
    renderReset();
    await waitFor(() => expect(screen.getByText('Definir nova senha')).toBeInTheDocument());
    expect(m.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' });
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it('URL é limpa imediatamente (antes do verifyOtp resolver) — token nunca fica na barra de endereço', () => {
    setUrl('/?token_hash=abc123&type=recovery');
    m.verifyOtp.mockReturnValue(new Promise(() => {})); // nunca resolve nesta asserção
    renderReset();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(document.body.innerHTML).not.toContain('abc123');
  });
});

describe('ResetPasswordView — callback implícito (access_token/refresh_token no hash)', () => {
  it('access_token + refresh_token + type=recovery válidos: setSession chamado, avança para o formulário', async () => {
    setUrl('/#access_token=at1&refresh_token=rt1&type=recovery');
    m.setSession.mockResolvedValue({ data: {}, error: null });
    renderReset();
    await waitFor(() => expect(screen.getByText('Definir nova senha')).toBeInTheDocument());
    expect(m.setSession).toHaveBeenCalledWith({ access_token: 'at1', refresh_token: 'rt1' });
    expect(m.verifyOtp).not.toHaveBeenCalled();
  });

  it('URL (hash) é limpa imediatamente — tokens nunca ficam na barra de endereço', () => {
    setUrl('/#access_token=at1&refresh_token=rt1&type=recovery');
    m.setSession.mockReturnValue(new Promise(() => {}));
    renderReset();
    expect(window.location.hash).toBe('');
    expect(document.body.innerHTML).not.toContain('at1');
    expect(document.body.innerHTML).not.toContain('rt1');
  });
});

describe('ResetPasswordView — link inválido/expirado/ausente', () => {
  it('sem nenhum parâmetro de recovery na URL: estado inválido imediato, nenhuma chamada de rede', async () => {
    setUrl('/');
    renderReset();
    await waitFor(() => expect(screen.getByText('Link inválido ou expirado')).toBeInTheDocument());
    expect(m.verifyOtp).not.toHaveBeenCalled();
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it('token_hash presente mas verifyOtp retorna erro (expirado/inválido): estado inválido', async () => {
    setUrl('/?token_hash=abc123&type=recovery');
    m.verifyOtp.mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } });
    renderReset();
    await waitFor(() => expect(screen.getByText('Link inválido ou expirado')).toBeInTheDocument());
    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it('estado inválido oferece "Solicitar nova recuperação" (volta para recover) e "Voltar ao login"', async () => {
    setUrl('/');
    const { setView } = renderReset();
    await waitFor(() => expect(screen.getByText('Link inválido ou expirado')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Solicitar nova recuperação'));
    expect(setView).toHaveBeenCalledWith('recover');
  });
});

describe('ResetPasswordView — nova senha', () => {
  async function reachValidForm() {
    setUrl('/?token_hash=abc123&type=recovery');
    m.verifyOtp.mockResolvedValue({ data: {}, error: null });
    const utils = renderReset();
    await waitFor(() => expect(screen.getByText('Definir nova senha')).toBeInTheDocument());
    return utils;
  }

  // PwField mistura o texto da label com o hint no cálculo do nome
  // acessível do wrapper <label> (sem for/id explícito) — getByLabelText
  // exato não é confiável aqui. Os dois campos de senha são os únicos
  // inputs com o placeholder padrão do PwField, sempre nesta ordem.
  function fillPasswords(password: string, confirmPassword: string) {
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: password } });
    fireEvent.change(confirm, { target: { value: confirmPassword } });
  }

  it('senha curta (<8): botão não chama updateUser', async () => {
    await reachValidForm();
    fillPasswords('123', '123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    expect(m.updateUser).not.toHaveBeenCalled();
  });

  it('confirmação divergente: mensagem exibida, updateUser não chamado', async () => {
    await reachValidForm();
    fillPasswords('senhaSegura123', 'outraSenha123');
    expect(screen.getByText('As senhas não coincidem.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Salvar nova senha'));
    expect(m.updateUser).not.toHaveBeenCalled();
  });

  it('senha válida + confirmação igual: updateUser chamado com a senha nova', async () => {
    m.updateUser.mockResolvedValue({ data: {}, error: null });
    m.signOut.mockResolvedValue({ error: null });
    await reachValidForm();
    fillPasswords('senhaSegura123', 'senhaSegura123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    await waitFor(() => expect(m.updateUser).toHaveBeenCalledWith({ password: 'senhaSegura123' }));
  });

  it('submit durante loading: double-click não chama updateUser duas vezes', async () => {
    let resolveCall: (v: any) => void = () => {};
    m.updateUser.mockReturnValue(new Promise((resolve) => { resolveCall = resolve; }));
    await reachValidForm();
    fillPasswords('senhaSegura123', 'senhaSegura123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    fireEvent.click(screen.getByText('Salvando…'));
    resolveCall({ data: {}, error: null });
    await waitFor(() => expect(screen.getByText('Senha atualizada!')).toBeInTheDocument());
    expect(m.updateUser).toHaveBeenCalledTimes(1);
  });

  it('updateUser sucesso: encerra a sessão (signOut) e mostra confirmação', async () => {
    m.updateUser.mockResolvedValue({ data: {}, error: null });
    m.signOut.mockResolvedValue({ error: null });
    await reachValidForm();
    fillPasswords('senhaSegura123', 'senhaSegura123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    await waitFor(() => expect(screen.getByText('Senha atualizada!')).toBeInTheDocument());
    expect(m.signOut).toHaveBeenCalled();
  });

  it('updateUser erro: mensagem controlada, sem tela de sucesso, signOut não chamado', async () => {
    m.updateUser.mockResolvedValue({ data: null, error: { message: 'New password should be different from the old password.' } });
    await reachValidForm();
    fillPasswords('senhaSegura123', 'senhaSegura123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    await waitFor(() => expect(screen.getByText('Não foi possível atualizar sua senha. Tente novamente.')).toBeInTheDocument());
    expect(screen.queryByText('Senha atualizada!')).toBeNull();
    expect(screen.queryByText(/old password/i)).toBeNull();
    expect(m.signOut).not.toHaveBeenCalled();
  });

  it('sucesso: "Ir para login" chama setView("login")', async () => {
    m.updateUser.mockResolvedValue({ data: {}, error: null });
    m.signOut.mockResolvedValue({ error: null });
    const { setView } = await reachValidForm();
    fillPasswords('senhaSegura123', 'senhaSegura123');
    fireEvent.click(screen.getByText('Salvar nova senha'));
    await waitFor(() => expect(screen.getByText('Senha atualizada!')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ir para login'));
    expect(setView).toHaveBeenCalledWith('login');
  });
});
