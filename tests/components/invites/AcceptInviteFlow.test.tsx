// tests/components/invites/AcceptInviteFlow.test.tsx — máquina de estados
// do aceite de convite (M1-F S4-C2B). Cliente principal, cliente
// temporário e acceptance-client mockados — nenhuma rede real.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn(),
  getUser: vi.fn(),
  validateInvite: vi.fn(),
  acceptInvite: vi.fn(),
  createTemporaryClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, replace: m.replace }),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: m.getSession,
      setSession: m.setSession,
      getUser: m.getUser,
    },
  },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/invites/acceptance-client', () => ({
  validateInvite: m.validateInvite,
  acceptInvite: m.acceptInvite,
}));

vi.mock('@/lib/invites/temporary-auth-client', () => ({
  createTemporaryInviteAuthClient: m.createTemporaryClient,
}));

import { AcceptInviteFlow } from '@/components/invites/AcceptInviteFlow';

const RAW_TOKEN = 'A'.repeat(43);
const AUTH_HASH = 'b'.repeat(40);
const TEMP_ACCESS_TOKEN = 'temp-access-token';
const TEMP_REFRESH_TOKEN = 'temp-refresh-token';
const USER_ID = 'user-abc-123';

function validFragment(authType: 'invite' | 'magiclink' = 'invite'): string {
  return `#invite_token=${RAW_TOKEN}&auth_token_hash=${AUTH_HASH}&auth_type=${authType}`;
}

function setLocationHash(hash: string) {
  window.history.replaceState(null, '', `/convite/aceitar${hash}`);
}

function makeTempClient(opts: {
  verifyOtpResult?: { data: any; error: any };
  getUserResult?: { data: any; error: any };
  updateUserResult?: { data: any; error: any };
} = {}) {
  const verifyOtp = vi.fn().mockResolvedValue(
    opts.verifyOtpResult ?? {
      data: {
        session: { access_token: TEMP_ACCESS_TOKEN, refresh_token: TEMP_REFRESH_TOKEN },
        user: { id: USER_ID },
      },
      error: null,
    },
  );
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserResult ?? { data: { user: { id: USER_ID } }, error: null },
  );
  const updateUser = vi.fn().mockResolvedValue(opts.updateUserResult ?? { data: {}, error: null });
  return { auth: { verifyOtp, getUser, updateUser } };
}

beforeEach(() => {
  setLocationHash(validFragment('invite'));
  m.getSession.mockResolvedValue({ data: { session: null } });
  m.validateInvite.mockResolvedValue({ outcome: 'ok', valid: true, code: 'ok', maskedEmail: 'f***@x.com' });
  m.acceptInvite.mockResolvedValue({ outcome: 'ok', success: true, code: 'ok', roleKind: 'seller' });
  m.createTemporaryClient.mockReturnValue(makeTempClient());
  m.setSession.mockResolvedValue({ data: {}, error: null });
  m.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/convite/aceitar');
});

async function clickContinue() {
  fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
}

describe('MOUNT — fragmento', () => {
  it('lê o fragmento e remove da URL imediatamente', async () => {
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    expect(window.location.hash).toBe('');
  });

  it('preserva pathname e search legítimos', async () => {
    window.history.replaceState(null, '', `/convite/aceitar?foo=bar${validFragment('invite')}`);
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    expect(window.location.pathname).toBe('/convite/aceitar');
    expect(window.location.search).toBe('?foo=bar');
    expect(window.location.hash).toBe('');
  });

  it('link incompleto (sem fragmento) mostra estado invalid_link', async () => {
    setLocationHash('');
    render(<AcceptInviteFlow />);
    await screen.findByText('Link incompleto');
  });

  it('zero chamada de rede/Auth no mount', async () => {
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    expect(m.validateInvite).not.toHaveBeenCalled();
    expect(m.createTemporaryClient).not.toHaveBeenCalled();
    expect(m.acceptInvite).not.toHaveBeenCalled();
    expect(m.getSession).not.toHaveBeenCalled();
  });

  it('React.StrictMode: segunda execução do efeito não transforma link válido em incompleto', async () => {
    render(
      <React.StrictMode>
        <AcceptInviteFlow />
      </React.StrictMode>,
    );
    await screen.findByText('Você recebeu um convite');
    expect(screen.queryByText('Link incompleto')).not.toBeInTheDocument();
  });
});

describe('CONTINUAR', () => {
  it('validate só é chamado após o clique, nunca no mount', async () => {
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    expect(m.validateInvite).not.toHaveBeenCalled();
    await clickContinue();
    await waitFor(() => expect(m.validateInvite).toHaveBeenCalledWith(RAW_TOKEN));
  });

  it('convite inválido não chama Auth (nem cliente temporário)', async () => {
    m.validateInvite.mockResolvedValue({ outcome: 'ok', valid: false, code: 'invite_expired', maskedEmail: null });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Este convite expirou.');
    expect(m.createTemporaryClient).not.toHaveBeenCalled();
  });

  it('convite válido sem sessão existente avança direto para autenticação', async () => {
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await waitFor(() => expect(m.createTemporaryClient).toHaveBeenCalledTimes(1));
  });

  it('rate limit no validate mostra Retry-After', async () => {
    m.validateInvite.mockResolvedValue({ outcome: 'rate_limited', retryAfterSeconds: 90 });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText(/90 segundos/);
  });

  it('falha de rede no validate oferece retry consciente (auditoria adversarial S4-C2C.1) e o retry chama validateInvite de novo', async () => {
    m.validateInvite.mockResolvedValueOnce({ outcome: 'error' });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Não foi possível continuar');
    const retryButton = await screen.findByRole('button', { name: 'Tentar novamente' });

    m.validateInvite.mockResolvedValueOnce({ outcome: 'ok', valid: true, code: 'ok', maskedEmail: 'f***@x.com' });
    fireEvent.click(retryButton);
    await waitFor(() => expect(m.validateInvite).toHaveBeenCalledTimes(2));
  });

  it('convite realmente inválido (ex.: expirado) NUNCA oferece retry — é um estado de domínio estável', async () => {
    m.validateInvite.mockResolvedValue({ outcome: 'ok', valid: false, code: 'invite_expired', maskedEmail: null });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Este convite expirou.');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('duplo clique síncrono em "Continuar" nunca chama validateInvite duas vezes (auditoria adversarial S4-C2C)', async () => {
    m.validateInvite.mockReturnValue(new Promise(() => {})); // nunca resolve, simula latência
    render(<AcceptInviteFlow />);
    const button = await screen.findByRole('button', { name: 'Continuar' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(m.validateInvite.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('SESSÃO EXISTENTE', () => {
  it('mostra aviso quando já existe sessão no cliente principal', async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: 'other-user-session' } } });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Conta já conectada');
  });

  it('cancelar preserva a sessão existente (nunca chama Auth/signOut) e navega para /', async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: 'other-user-session' } } });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Conta já conectada');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(m.createTemporaryClient).not.toHaveBeenCalled();
    expect(m.setSession).not.toHaveBeenCalled();
    expect(m.push).toHaveBeenCalledWith('/');
  });

  it('continuar não faz signOut e só então cria o cliente temporário', async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: 'other-user-session' } } });
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Conta já conectada');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar e trocar ao finalizar' }));
    await waitFor(() => expect(m.createTemporaryClient).toHaveBeenCalledTimes(1));
    expect(m.setSession).not.toHaveBeenCalled();
  });
});

async function advanceToPasswordStep(authType: 'invite' | 'magiclink' = 'invite') {
  setLocationHash(validFragment(authType));
  render(<AcceptInviteFlow />);
  await screen.findByText('Você recebeu um convite');
  await clickContinue();
  await screen.findByText(authType === 'invite' ? 'Defina sua senha' : 'Senha da sua conta');
}

describe('AUTH (verifyOtp)', () => {
  it('invite: chama verifyOtp com type=invite', async () => {
    await advanceToPasswordStep('invite');
    const client = m.createTemporaryClient.mock.results[0].value;
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: AUTH_HASH, type: 'invite' });
  });

  it('magiclink: chama verifyOtp com type=magiclink', async () => {
    await advanceToPasswordStep('magiclink');
    const client = m.createTemporaryClient.mock.results[0].value;
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: AUTH_HASH, type: 'magiclink' });
  });

  it('erro no verifyOtp mostra auth_error, nunca AuthApiError bruto', async () => {
    m.createTemporaryClient.mockReturnValue(
      makeTempClient({ verifyOtpResult: { data: { session: null, user: null }, error: { status: 401, message: 'token has expired or is invalid' } } }),
    );
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Não foi possível autenticar');
    expect(screen.queryByText(/token has expired/)).not.toBeInTheDocument();
  });

  it('chama getUser(access_token) após verifyOtp e confirma o mesmo user.id', async () => {
    await advanceToPasswordStep('invite');
    const client = m.createTemporaryClient.mock.results[0].value;
    expect(client.auth.getUser).toHaveBeenCalledWith(TEMP_ACCESS_TOKEN);
  });

  it('identidade incoerente (getUser devolve outro id) → auth_error, nunca avança', async () => {
    m.createTemporaryClient.mockReturnValue(
      makeTempClient({ getUserResult: { data: { user: { id: 'outro-id-diferente' } }, error: null } }),
    );
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    await clickContinue();
    await screen.findByText('Não foi possível autenticar');
  });

  it('sessão temporária nunca aparece em nenhum texto renderizado', async () => {
    await advanceToPasswordStep('invite');
    expect(screen.queryByText(TEMP_ACCESS_TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByText(TEMP_REFRESH_TOKEN)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TEMP_ACCESS_TOKEN);
    expect(document.body.innerHTML).not.toContain(TEMP_REFRESH_TOKEN);
  });
});

describe('SENHA', () => {
  it('invite: senha é obrigatória (sem opção de pular)', async () => {
    await advanceToPasswordStep('invite');
    expect(screen.queryByRole('button', { name: 'Continuar sem alterar minha senha' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Definir senha e continuar' })).toBeInTheDocument();
  });

  it('magiclink: senha é opcional (mostra pular)', async () => {
    await advanceToPasswordStep('magiclink');
    expect(screen.getByRole('button', { name: 'Continuar sem alterar minha senha' })).toBeInTheDocument();
  });

  it('confirmação divergente mostra aviso e mantém o botão desabilitado (nunca chama updateUser)', async () => {
    await advanceToPasswordStep('invite');
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senhaDIFERENTE' } });
    await screen.findByText('As senhas não coincidem.');
    expect(screen.getByRole('button', { name: 'Definir senha e continuar' })).toBeDisabled();
    const client = m.createTemporaryClient.mock.results[0].value;
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('senha coincidente chama updateUser e avança para confirmação', async () => {
    await advanceToPasswordStep('invite');
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha e continuar' }));
    const client = m.createTemporaryClient.mock.results[0].value;
    await waitFor(() => expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'senha123' }));
    await screen.findByText('Ativar minha conta');
  });

  it('falha no updateUser mostra erro e permanece na etapa de senha', async () => {
    m.createTemporaryClient.mockReturnValue(makeTempClient({ updateUserResult: { data: {}, error: { message: 'weak password' } } }));
    await advanceToPasswordStep('invite');
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha e continuar' }));
    await screen.findByText('Não foi possível definir a senha. Tente novamente.');
  });

  it('campos de senha são limpos após submit bem-sucedido', async () => {
    await advanceToPasswordStep('invite');
    const passwordInput = screen.getByLabelText('Nova senha') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha e continuar' }));
    await screen.findByText('Ativar minha conta');
    // O campo de senha não existe mais nesta fase — impossível reexibir o valor antigo.
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  });

  it('magiclink: pular vai direto para confirmação sem chamar updateUser', async () => {
    await advanceToPasswordStep('magiclink');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar sem alterar minha senha' }));
    await screen.findByText('Ativar minha conta');
    const client = m.createTemporaryClient.mock.results[0].value;
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });
});

async function advanceToConfirmActivation() {
  await advanceToPasswordStep('magiclink');
  fireEvent.click(screen.getByRole('button', { name: 'Continuar sem alterar minha senha' }));
  await screen.findByText('Ativar minha conta');
}

describe('ACEITE', () => {
  it('accept só é chamado pelo botão explícito, com o Bearer temporário', async () => {
    await advanceToConfirmActivation();
    expect(m.acceptInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await waitFor(() => expect(m.acceptInvite).toHaveBeenCalledWith(RAW_TOKEN, TEMP_ACCESS_TOKEN));
  });

  it('duplo clique não chama accept duas vezes', async () => {
    let resolveAccept: (value: unknown) => void = () => {};
    m.acceptInvite.mockReturnValue(new Promise((resolve) => { resolveAccept = resolve; }));
    await advanceToConfirmActivation();
    const button = screen.getByRole('button', { name: 'Ativar minha conta' });
    fireEvent.click(button);
    fireEvent.click(button);
    resolveAccept({ outcome: 'ok', success: true, code: 'ok', roleKind: 'seller' });
    await waitFor(() => expect(m.acceptInvite).toHaveBeenCalledTimes(1));
  });

  it('erro de domínio (membership_conflict) mostra mensagem administrativa e não altera sessão principal', async () => {
    m.acceptInvite.mockResolvedValue({ outcome: 'ok', success: false, code: 'membership_conflict', roleKind: null });
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText('Sua conta possui um vínculo que precisa ser resolvido pelo administrador.');
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it('erro de rede permite retry consciente (retryable)', async () => {
    m.acceptInvite.mockResolvedValue({ outcome: 'error' });
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByRole('button', { name: 'Tentar novamente' });
  });

  it('rate_limited no accept não é retryable imediatamente (sem botão de retry)', async () => {
    m.acceptInvite.mockResolvedValue({ outcome: 'rate_limited', retryAfterSeconds: 30 });
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText(/30 segundos/);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });
});

describe('TRANSFERÊNCIA DE SESSÃO', () => {
  it('setSession/getUser só são chamados APÓS success=true', async () => {
    await advanceToConfirmActivation();
    expect(m.setSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await waitFor(() => expect(m.setSession).toHaveBeenCalledWith({ access_token: TEMP_ACCESS_TOKEN, refresh_token: TEMP_REFRESH_TOKEN }));
  });

  it('confirma getUser() do cliente principal com o mesmo user.id da sessão temporária', async () => {
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await waitFor(() => expect(m.getUser).toHaveBeenCalled());
  });

  it('sucesso completo: redireciona para / via router.replace', async () => {
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText('Conta ativada!');
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('/'));
  });

  it('IDs divergentes entre sessão temporária e getUser do cliente principal → activated_but_login_failed', async () => {
    m.getUser.mockResolvedValue({ data: { user: { id: 'id-diferente' } }, error: null });
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText('Sua conta foi ativada, mas não foi possível iniciar a sessão automaticamente.');
  });

  it('falha no setSession pós-aceite → activated_but_login_failed, nunca "ativação falhou"', async () => {
    m.setSession.mockResolvedValue({ data: {}, error: { message: 'boom' } });
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText('Sua conta foi ativada, mas não foi possível iniciar a sessão automaticamente.');
    expect(screen.queryByText(/ativação falhou/i)).not.toBeInTheDocument();
  });
});

describe('REDACTION', () => {
  it('nenhum token/hash/JWT aparece no DOM em nenhuma fase visitada', async () => {
    await advanceToConfirmActivation();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    await screen.findByText('Conta ativada!');

    const html = document.body.innerHTML;
    expect(html).not.toContain(RAW_TOKEN);
    expect(html).not.toContain(AUTH_HASH);
    expect(html).not.toContain(TEMP_ACCESS_TOKEN);
    expect(html).not.toContain(TEMP_REFRESH_TOKEN);
  });

  it('nenhum link completo (fragmento) aparece no DOM', async () => {
    render(<AcceptInviteFlow />);
    await screen.findByText('Você recebeu um convite');
    expect(document.body.innerHTML).not.toContain('invite_token=');
    expect(document.body.innerHTML).not.toContain('auth_token_hash=');
  });
});
