'use client';
// components/users/ChangeUserEmailModal.tsx — modal SEPARADO de alteração
// administrativa de e-mail (M1-F S5-E1-B, decisão de experiência
// congelada). Nunca participa do mesmo formulário/salvamento de
// EditUserModal (nome/papel) — o e-mail também altera o login, exige
// confirmação própria e usa um Route Handler diferente (S5-E1-A). Nenhuma
// atomicidade com nome/papel: esta é uma operação isolada, com sua própria
// sequência de confirmação → chamada → sucesso/erro.
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FlowShell } from '@/components/flows/FlowsShared';
import { useUpdateUserEmail, getUpdateUserEmailErrorMessage } from '@/lib/hooks/useUpdateUserEmail';
import type { CompanyUserRow } from '@/lib/users/repository';
import { AuthService } from '@/lib/services';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

export type ChangeUserEmailModalProps = {
  // Ator (Super Admin) — usado só para autorizar a mutation e a geração de
  // cache. Capability real (canEditEmail) já foi decidida pelo chamador
  // (ActiveUserList), nunca por este modal.
  userId: string;
  user: CompanyUserRow;
  onClose: () => void;
};

export function ChangeUserEmailModal({ userId, user, onClose }: ChangeUserEmailModalProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const getAccessToken = React.useCallback(async () => {
    const { data } = await AuthService.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const { updateUserEmail } = useUpdateUserEmail({ userId, authorized: true, getAccessToken });

  const trimmed = email.trim();
  const hasControlChar = CONTROL_CHAR_PATTERN.test(email);
  const hasInternalSpace = /\s/.test(trimmed);
  const normalized = trimmed.toLowerCase();
  const formatInvalid = trimmed === '' || trimmed.length > MAX_EMAIL_LENGTH || hasControlChar || hasInternalSpace || !EMAIL_PATTERN.test(normalized);
  const sameAsCurrent = !formatInvalid && normalized === user.email.trim().toLowerCase();
  const canSubmit = !saving && !formatInvalid && !sameAsCurrent;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await updateUserEmail({ profileId: user.profile_id, email: normalized });
      if (result.outcome === 'ok') {
        onClose();
        return;
      }
      setError(getUpdateUserEmailErrorMessage(result));
    } catch (err) {
      setError(getUpdateUserEmailErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;

    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Alterar e-mail de acesso?',
      message: `${user.name} passará a usar ${normalized} para entrar na conta. As sessões que já estão abertas não serão encerradas automaticamente.`,
      confirmLabel: 'Confirmar alteração',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      icon: 'send',
      onConfirm: () => { void performSave(); },
    });
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Alterar e-mail de acesso"
      icon="send"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={saving ? 'refresh' : 'check'} onClick={handleSaveClick}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </LBtn>
        </>
      }
    >
      {error && (
        <div role="alert" style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Usuário</span>
        <div style={{ fontSize: 15, color: 'var(--t-900)' }}>{user.name}</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>E-mail atual</span>
        <div style={{ fontSize: 15, color: 'var(--t-900)' }}>{user.email}</div>
      </div>

      <FField label="Novo e-mail" icon="send" placeholder="novo@email.com" type="email" value={email} autoFocus
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
      {trimmed !== '' && formatInvalid && (
        <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>
          Informe um endereço de e-mail válido.
        </div>
      )}

      <div style={{ marginTop: 4, marginBottom: 10, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="alert" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Este endereço passará a ser usado para entrar na conta.</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>As sessões que já estão abertas não serão encerradas automaticamente.</span>
      </div>
    </FlowShell>
  );
}
