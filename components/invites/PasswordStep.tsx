'use client';
// components/invites/PasswordStep.tsx — formulário de senha do fluxo de
// aceite de convite (M1-F S4-C2B). O valor bruto da senha vive SOMENTE
// neste componente folha (useState local) — nunca sobe para o reducer de
// AcceptInviteFlow, nunca aparece em nenhum estado serializável da
// máquina de estados principal. Limpo imediatamente após o submit, com
// sucesso ou falha.
import React, { useState } from 'react';

export interface PasswordStepProps {
  mode: 'required' | 'optional';
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (password: string) => void;
  onSkip?: () => void;
}

const MIN_LENGTH = 6;

export function PasswordStep({ mode, submitting, errorMessage, onSubmit, onSkip }: PasswordStepProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Derivado a cada render (não um useState separado): a confirmação
  // diverge assim que os dois campos têm conteúdo e não coincidem —
  // nunca depende de um submit que o próprio botão desabilitado
  // impediria de disparar.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit = password.length >= MIN_LENGTH && password === confirmPassword && !submitting;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      return;
    }
    onSubmit(password);
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 id="invite-step-title" style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--t-900)' }}>
        {mode === 'required' ? 'Defina sua senha' : 'Senha da sua conta'}
      </h2>
      <p style={{ margin: '0 0 20px', color: 'var(--t-500)', fontSize: 14 }}>
        {mode === 'required'
          ? 'Esta senha será usada para acessar o AutoCRM.'
          : 'Você pode continuar sem alterar sua senha atual, ou definir uma nova — isso substituirá a senha existente.'}
      </p>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>
          Nova senha
        </span>
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_LENGTH}
          required
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,.03)',
            color: 'var(--t-900)',
            fontFamily: 'inherit',
            fontSize: 15,
          }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>
          Confirmar senha
        </span>
        <input
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={MIN_LENGTH}
          required
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,.03)',
            color: 'var(--t-900)',
            fontFamily: 'inherit',
            fontSize: 15,
          }}
        />
      </label>

      <div role="alert" aria-live="polite" style={{ minHeight: 20, marginBottom: 8 }}>
        {mismatch && <span style={{ fontSize: 13, color: '#FF4242' }}>As senhas não coincidem.</span>}
        {errorMessage && <span style={{ fontSize: 13, color: '#FF4242' }}>{errorMessage}</span>}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        aria-busy={submitting}
        style={{
          width: '100%',
          padding: '13px',
          borderRadius: 12,
          border: 'none',
          background: canSubmit ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'rgba(255,255,255,.08)',
          color: canSubmit ? '#241c04' : 'var(--t-500)',
          fontWeight: 700,
          fontSize: 15,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Salvando…' : 'Definir senha e continuar'}
      </button>

      {mode === 'optional' && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '12px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--t-500)',
            fontSize: 14,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          Continuar sem alterar minha senha
        </button>
      )}
    </form>
  );
}
