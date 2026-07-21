'use client';
// components/invites/AcceptInviteFlow.tsx — máquina de estados do aceite
// de convite (M1-F S4-C2B). Única fronteira 'use client' de toda a rota
// /convite/aceitar (a page.tsx continua Server Component).
//
// Tokens (invite_token, auth_token_hash) e a sessão temporária do
// convidado (access_token/refresh_token) vivem EXCLUSIVAMENTE em refs —
// nunca em useState, nunca em nenhum campo do reducer abaixo. O reducer
// só guarda dados seguros para renderizar: fase atual, e-mail mascarado,
// código de erro fechado, retry_after e o rótulo de papel pós-sucesso.
import React, { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { parseInviteFragment, type InviteAuthType } from '@/lib/invites/fragment';
import { createTemporaryInviteAuthClient } from '@/lib/invites/temporary-auth-client';
import { validateInvite, acceptInvite, type InviteRoleKind } from '@/lib/invites/acceptance-client';
import { PasswordStep } from '@/components/invites/PasswordStep';

// ── máquina de estados: fases fechadas, nenhum payload sensível ──────────
type FlowState =
  | { phase: 'parsing' }
  | { phase: 'invalid_link' }
  | { phase: 'ready' }
  | { phase: 'validating' }
  | { phase: 'invite_invalid'; code: string; retryAfterSeconds: number | null; retryable: boolean }
  | { phase: 'existing_session_warning'; maskedEmail: string | null }
  | { phase: 'authenticating'; maskedEmail: string | null }
  | { phase: 'auth_error'; maskedEmail: string | null; code: string }
  | { phase: 'password_required'; maskedEmail: string | null; submitting: boolean; error: string | null }
  | { phase: 'password_optional'; maskedEmail: string | null; submitting: boolean; error: string | null }
  | { phase: 'confirm_activation'; maskedEmail: string | null }
  | { phase: 'accepting'; maskedEmail: string | null }
  | { phase: 'activation_error'; code: string; retryAfterSeconds: number | null; retryable: boolean }
  | { phase: 'transferring_session' }
  | { phase: 'success'; roleLabel: string }
  | { phase: 'activated_but_login_failed' };

type Action =
  | { type: 'INVALID_LINK' }
  | { type: 'READY' }
  | { type: 'VALIDATING' }
  | { type: 'INVITE_INVALID'; code: string; retryAfterSeconds: number | null }
  | { type: 'EXISTING_SESSION_WARNING'; maskedEmail: string | null }
  | { type: 'AUTHENTICATING'; maskedEmail: string | null }
  | { type: 'AUTH_ERROR'; maskedEmail: string | null; code: string }
  | { type: 'PASSWORD_REQUIRED'; maskedEmail: string | null }
  | { type: 'PASSWORD_OPTIONAL'; maskedEmail: string | null }
  | { type: 'PASSWORD_SUBMIT_START' }
  | { type: 'PASSWORD_SUBMIT_ERROR'; message: string }
  | { type: 'CONFIRM_ACTIVATION'; maskedEmail: string | null }
  | { type: 'ACCEPTING'; maskedEmail: string | null }
  | { type: 'ACTIVATION_ERROR'; code: string; retryAfterSeconds: number | null; retryable: boolean }
  | { type: 'TRANSFERRING_SESSION' }
  | { type: 'SUCCESS'; roleLabel: string }
  | { type: 'ACTIVATED_BUT_LOGIN_FAILED' };

function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case 'INVALID_LINK':
      return { phase: 'invalid_link' };
    case 'READY':
      return { phase: 'ready' };
    case 'VALIDATING':
      return { phase: 'validating' };
    case 'INVITE_INVALID':
      // Só falha de rede é recuperável por natureza — os demais códigos
      // (convite expirado/cancelado/já usado/etc.) são estados de domínio
      // estáveis que um retry nunca resolveria.
      return {
        phase: 'invite_invalid',
        code: action.code,
        retryAfterSeconds: action.retryAfterSeconds,
        retryable: action.code === 'network_error',
      };
    case 'EXISTING_SESSION_WARNING':
      return { phase: 'existing_session_warning', maskedEmail: action.maskedEmail };
    case 'AUTHENTICATING':
      return { phase: 'authenticating', maskedEmail: action.maskedEmail };
    case 'AUTH_ERROR':
      return { phase: 'auth_error', maskedEmail: action.maskedEmail, code: action.code };
    case 'PASSWORD_REQUIRED':
      return { phase: 'password_required', maskedEmail: action.maskedEmail, submitting: false, error: null };
    case 'PASSWORD_OPTIONAL':
      return { phase: 'password_optional', maskedEmail: action.maskedEmail, submitting: false, error: null };
    case 'PASSWORD_SUBMIT_START':
      if (state.phase !== 'password_required' && state.phase !== 'password_optional') return state;
      return { ...state, submitting: true, error: null };
    case 'PASSWORD_SUBMIT_ERROR':
      if (state.phase !== 'password_required' && state.phase !== 'password_optional') return state;
      return { ...state, submitting: false, error: action.message };
    case 'CONFIRM_ACTIVATION':
      return { phase: 'confirm_activation', maskedEmail: action.maskedEmail };
    case 'ACCEPTING':
      return { phase: 'accepting', maskedEmail: action.maskedEmail };
    case 'ACTIVATION_ERROR':
      return { phase: 'activation_error', code: action.code, retryAfterSeconds: action.retryAfterSeconds, retryable: action.retryable };
    case 'TRANSFERRING_SESSION':
      return { phase: 'transferring_session' };
    case 'SUCCESS':
      return { phase: 'success', roleLabel: action.roleLabel };
    case 'ACTIVATED_BUT_LOGIN_FAILED':
      return { phase: 'activated_but_login_failed' };
    default:
      return state;
  }
}

const ROLE_LABELS: Record<InviteRoleKind, string> = {
  super_admin: 'Super Admin',
  manager: 'Gerente',
  seller: 'Vendedor',
};

const INVITE_INVALID_MESSAGES: Record<string, string> = {
  invalid_token_hash: 'Este link de convite não é válido.',
  invite_not_found: 'Este link de convite não é válido.',
  invite_expired: 'Este convite expirou.',
  invite_not_actionable: 'Este convite não está mais disponível.',
  invite_already_used: 'Este convite já foi utilizado.',
  company_not_operational: 'Este convite não está disponível no momento.',
  rate_limited: 'Muitas tentativas em pouco tempo.',
  network_error: 'Não foi possível confirmar o convite agora.',
};

const ACTIVATION_ERROR_MESSAGES: Record<string, string> = {
  email_mismatch: 'A conta autenticada não corresponde ao convite.',
  membership_conflict: 'Sua conta possui um vínculo que precisa ser resolvido pelo administrador.',
  invalid_relationship: 'Esta ativação precisa ser resolvida pelo administrador.',
  identity_conflict: 'Fale com o administrador para continuar.',
  provisioning_failed: 'Ocorreu um erro temporário. Fale com o administrador se persistir.',
  invite_not_found: 'Este link de convite não é válido.',
  invite_expired: 'Este convite expirou.',
  invite_already_used: 'Este convite já foi utilizado.',
  invite_not_actionable: 'Este convite não está mais disponível.',
  company_not_operational: 'Este convite não está disponível no momento.',
  already_member: 'Você já faz parte desta empresa.',
  rate_limited: 'Muitas tentativas em pouco tempo.',
  network_error: 'Não foi possível concluir a ativação agora.',
  session_lost: 'Sua sessão temporária foi perdida. Abra o link novamente.',
};

function classifyVerifyOtpError(error: unknown): string {
  const e = error as { status?: unknown; code?: unknown; name?: unknown } | null;
  if (e && e.name === 'AuthRetryableFetchError') return 'network_error';
  if (e && (e.status === 401 || e.status === 403)) return 'auth_invalid';
  return 'auth_invalid';
}

interface TemporarySession {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export function AcceptInviteFlow() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, { phase: 'parsing' });

  const hasParsedRef = useRef(false);
  const inviteTokenRef = useRef<string | null>(null);
  const authTokenHashRef = useRef<string | null>(null);
  const authTypeRef = useRef<InviteAuthType | null>(null);
  const tempClientRef = useRef<ReturnType<typeof createTemporaryInviteAuthClient> | null>(null);
  const tempSessionRef = useRef<TemporarySession | null>(null);
  const acceptGuardRef = useRef(false);

  // Mount único: lê o fragmento, remove IMEDIATAMENTE da URL, guarda os
  // tokens só em refs. Guarda contra Strict Mode: hasParsedRef sobrevive
  // ao segundo disparo do efeito em dev, que veria location.hash já
  // vazio (apagado pelo replaceState da primeira execução) — sem a
  // guarda, isso transformaria um link válido em "link incompleto".
  useEffect(() => {
    if (hasParsedRef.current) return;
    hasParsedRef.current = true;

    const result = parseInviteFragment(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!result.ok) {
      dispatch({ type: 'INVALID_LINK' });
      return;
    }

    inviteTokenRef.current = result.value.inviteToken;
    authTokenHashRef.current = result.value.authTokenHash;
    authTypeRef.current = result.value.authType;
    dispatch({ type: 'READY' });
  }, []);

  useEffect(() => {
    if (state.phase === 'success') {
      router.replace('/');
    }
  }, [state.phase, router]);

  async function performAuthentication(maskedEmail: string | null) {
    const authTokenHash = authTokenHashRef.current;
    const authType = authTypeRef.current;
    if (!authTokenHash || !authType) {
      dispatch({ type: 'AUTH_ERROR', maskedEmail, code: 'invalid_link' });
      return;
    }

    const client = createTemporaryInviteAuthClient();
    tempClientRef.current = client;

    const { data, error } = await client.auth.verifyOtp({ token_hash: authTokenHash, type: authType });

    if (
      error ||
      !data.session ||
      !data.user ||
      !data.session.access_token ||
      !data.session.refresh_token ||
      !data.user.id
    ) {
      dispatch({ type: 'AUTH_ERROR', maskedEmail, code: classifyVerifyOtpError(error) });
      return;
    }

    const { data: userData, error: userError } = await client.auth.getUser(data.session.access_token);
    if (userError || !userData.user || userData.user.id !== data.user.id) {
      dispatch({ type: 'AUTH_ERROR', maskedEmail, code: 'identity_mismatch' });
      return;
    }

    tempSessionRef.current = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: userData.user.id,
    };

    if (authType === 'invite') {
      dispatch({ type: 'PASSWORD_REQUIRED', maskedEmail });
    } else {
      dispatch({ type: 'PASSWORD_OPTIONAL', maskedEmail });
    }
  }

  async function handleContinue() {
    const token = inviteTokenRef.current;
    if (!token) {
      dispatch({ type: 'INVALID_LINK' });
      return;
    }

    dispatch({ type: 'VALIDATING' });
    const result = await validateInvite(token);

    if (result.outcome === 'error') {
      dispatch({ type: 'INVITE_INVALID', code: 'network_error', retryAfterSeconds: null });
      return;
    }
    if (result.outcome === 'rate_limited') {
      dispatch({ type: 'INVITE_INVALID', code: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    if (!result.valid) {
      dispatch({ type: 'INVITE_INVALID', code: result.code, retryAfterSeconds: null });
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      dispatch({ type: 'EXISTING_SESSION_WARNING', maskedEmail: result.maskedEmail });
      return;
    }

    dispatch({ type: 'AUTHENTICATING', maskedEmail: result.maskedEmail });
    await performAuthentication(result.maskedEmail);
  }

  function handleCancelExistingSession() {
    router.push('/');
  }

  async function handleContinueExistingSession(maskedEmail: string | null) {
    dispatch({ type: 'AUTHENTICATING', maskedEmail });
    await performAuthentication(maskedEmail);
  }

  async function handlePasswordSubmit(maskedEmail: string | null, password: string) {
    dispatch({ type: 'PASSWORD_SUBMIT_START' });
    const client = tempClientRef.current;
    if (!client) {
      dispatch({ type: 'PASSWORD_SUBMIT_ERROR', message: 'Sessão temporária perdida. Abra o link novamente.' });
      return;
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      dispatch({ type: 'PASSWORD_SUBMIT_ERROR', message: 'Não foi possível definir a senha. Tente novamente.' });
      return;
    }
    dispatch({ type: 'CONFIRM_ACTIVATION', maskedEmail });
  }

  function handlePasswordSkip(maskedEmail: string | null) {
    dispatch({ type: 'CONFIRM_ACTIVATION', maskedEmail });
  }

  async function handleAccept(maskedEmail: string | null) {
    if (acceptGuardRef.current) return;
    acceptGuardRef.current = true;
    dispatch({ type: 'ACCEPTING', maskedEmail });

    const token = inviteTokenRef.current;
    const session = tempSessionRef.current;
    if (!token || !session) {
      acceptGuardRef.current = false;
      dispatch({ type: 'ACTIVATION_ERROR', code: 'session_lost', retryAfterSeconds: null, retryable: false });
      return;
    }

    const result = await acceptInvite(token, session.accessToken);
    acceptGuardRef.current = false;

    if (result.outcome === 'error') {
      dispatch({ type: 'ACTIVATION_ERROR', code: 'network_error', retryAfterSeconds: null, retryable: true });
      return;
    }
    if (result.outcome === 'rate_limited') {
      dispatch({ type: 'ACTIVATION_ERROR', code: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds, retryable: false });
      return;
    }
    if (!result.success) {
      dispatch({ type: 'ACTIVATION_ERROR', code: result.code, retryAfterSeconds: null, retryable: false });
      return;
    }

    dispatch({ type: 'TRANSFERRING_SESSION' });
    await transferSession(result.roleKind);
  }

  async function transferSession(roleKind: InviteRoleKind | null) {
    const session = tempSessionRef.current;
    if (!session) {
      dispatch({ type: 'ACTIVATED_BUT_LOGIN_FAILED' });
      return;
    }

    const { error } = await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (error) {
      dispatch({ type: 'ACTIVATED_BUT_LOGIN_FAILED' });
      return;
    }

    const { data, error: getUserError } = await supabase.auth.getUser();
    if (getUserError || !data.user || data.user.id !== session.userId) {
      dispatch({ type: 'ACTIVATED_BUT_LOGIN_FAILED' });
      return;
    }

    tempSessionRef.current = null;
    inviteTokenRef.current = null;
    authTokenHashRef.current = null;
    authTypeRef.current = null;

    const roleLabel = roleKind ? ROLE_LABELS[roleKind] : '';
    dispatch({ type: 'SUCCESS', roleLabel });
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0a0a0b', padding: 24 }}>
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'linear-gradient(180deg,#161618,#0f0f11)',
          border: '1px solid var(--border)',
          borderRadius: 22,
          padding: 34,
          boxShadow: 'var(--shadow-lg)',
        }}
        aria-live="polite"
      >
        {state.phase === 'parsing' && (
          <p style={{ color: 'var(--t-500)', fontSize: 14 }}>Carregando…</p>
        )}

        {state.phase === 'invalid_link' && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Link incompleto</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              Abra novamente o link recebido por e-mail. Se o problema persistir, peça um novo convite ao administrador.
            </p>
            <button type="button" onClick={() => router.push('/')} style={secondaryButtonStyle}>
              Voltar ao início
            </button>
          </div>
        )}

        {state.phase === 'ready' && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>
              Você recebeu um convite
            </h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              Confirme para continuar com a ativação da sua conta no AutoCRM.
            </p>
            <button type="button" onClick={() => void handleContinue()} style={primaryButtonStyle}>
              Continuar
            </button>
          </div>
        )}

        {state.phase === 'validating' && <p style={{ color: 'var(--t-500)', fontSize: 14 }}>Verificando convite…</p>}

        {state.phase === 'invite_invalid' && (
          <div role="alert">
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Não foi possível continuar</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              {INVITE_INVALID_MESSAGES[state.code] ?? 'Este convite não pôde ser confirmado.'}
              {state.code === 'rate_limited' && state.retryAfterSeconds != null && (
                <> Tente novamente em cerca de {state.retryAfterSeconds} segundos.</>
              )}
            </p>
            {state.retryable ? (
              <button type="button" onClick={() => void handleContinue()} style={{ ...primaryButtonStyle, marginBottom: 10 }}>
                Tentar novamente
              </button>
            ) : null}
            <button type="button" onClick={() => router.push('/')} style={secondaryButtonStyle}>
              Voltar ao início
            </button>
          </div>
        )}

        {state.phase === 'existing_session_warning' && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Conta já conectada</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              Já existe uma conta conectada neste navegador. Ao concluir a ativação, ela será substituída pela conta deste convite.
            </p>
            <button
              type="button"
              onClick={() => void handleContinueExistingSession(state.maskedEmail)}
              style={{ ...primaryButtonStyle, marginBottom: 10 }}
            >
              Continuar e trocar ao finalizar
            </button>
            <button type="button" onClick={handleCancelExistingSession} style={secondaryButtonStyle}>
              Cancelar
            </button>
          </div>
        )}

        {state.phase === 'authenticating' && <p style={{ color: 'var(--t-500)', fontSize: 14 }}>Autenticando…</p>}

        {state.phase === 'auth_error' && (
          <div role="alert">
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Não foi possível autenticar</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              Este link pode ter expirado ou já ter sido utilizado. Peça um novo convite ao administrador.
            </p>
            <button type="button" onClick={() => router.push('/')} style={secondaryButtonStyle}>
              Voltar ao início
            </button>
          </div>
        )}

        {(state.phase === 'password_required' || state.phase === 'password_optional') && (
          <PasswordStep
            mode={state.phase === 'password_required' ? 'required' : 'optional'}
            submitting={state.submitting}
            errorMessage={state.error}
            onSubmit={(password) => void handlePasswordSubmit(state.maskedEmail, password)}
            onSkip={state.phase === 'password_optional' ? () => handlePasswordSkip(state.maskedEmail) : undefined}
          />
        )}

        {state.phase === 'confirm_activation' && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Tudo pronto</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              {state.maskedEmail ? <>Conta: {state.maskedEmail}</> : 'Confirme para ativar sua conta.'}
            </p>
            <button type="button" onClick={() => void handleAccept(state.maskedEmail)} style={primaryButtonStyle}>
              Ativar minha conta
            </button>
          </div>
        )}

        {state.phase === 'accepting' && <p style={{ color: 'var(--t-500)', fontSize: 14 }}>Ativando sua conta…</p>}

        {state.phase === 'activation_error' && (
          <div role="alert">
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Não foi possível ativar</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              {ACTIVATION_ERROR_MESSAGES[state.code] ?? 'Ocorreu um erro inesperado.'}
              {state.code === 'rate_limited' && state.retryAfterSeconds != null && (
                <> Tente novamente em cerca de {state.retryAfterSeconds} segundos.</>
              )}
            </p>
            {state.retryable ? (
              <button type="button" onClick={() => void handleAccept(null)} style={primaryButtonStyle}>
                Tentar novamente
              </button>
            ) : (
              <button type="button" onClick={() => router.push('/')} style={secondaryButtonStyle}>
                Voltar ao início
              </button>
            )}
          </div>
        )}

        {state.phase === 'transferring_session' && <p style={{ color: 'var(--t-500)', fontSize: 14 }}>Finalizando…</p>}

        {state.phase === 'success' && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Conta ativada!</h2>
            <p style={{ margin: 0, color: 'var(--t-500)', fontSize: 14 }}>
              {state.roleLabel ? <>Bem-vindo(a) — acesso: {state.roleLabel}.</> : 'Redirecionando…'}
            </p>
          </div>
        )}

        {state.phase === 'activated_but_login_failed' && (
          <div role="alert">
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>Conta ativada</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
              Sua conta foi ativada, mas não foi possível iniciar a sessão automaticamente.
            </p>
            <button type="button" onClick={() => router.push('/')} style={primaryButtonStyle}>
              Ir para o login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(180deg,#E8CE72,#C9A227)',
  color: '#241c04',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--t-500)',
  fontSize: 14,
  cursor: 'pointer',
};
