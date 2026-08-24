'use client';
// components/users/SuspendMembershipModal.tsx — modal de suspensão
// empresarial (M1-F S6-F, RPC suspend_membership de S6-B). Motivo
// OBRIGATÓRIO; avisa que o acesso à empresa será bloqueado; histórico é
// preservado (nenhum dado é apagado). Suspensão é reversível (ver
// ReactivateMembershipModal) — nunca confundida com desligamento.
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FArea, FlowShell } from '@/components/flows/FlowsShared';
import { useSuspendMembership, getSuspendMembershipErrorMessage } from '@/lib/hooks/useSuspendMembership';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

export type SuspendMembershipModalProps = {
  userId: string;
  user: MembershipLifecycleTargetUser;
  onClose: () => void;
};

export function SuspendMembershipModal({ userId, user, onClose }: SuspendMembershipModalProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const { suspendMembership } = useSuspendMembership({ userId, authorized: true });

  const trimmedNote = note.trim();
  const canSubmit = !saving && trimmedNote.length >= 3 && trimmedNote.length <= 500;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await suspendMembership({ membershipId: user.membership_id, note: trimmedNote });
      onClose();
    } catch (err) {
      setError(getSuspendMembershipErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Suspender usuário?',
      message: `${user.name} perderá o acesso à empresa até ser reativado. O histórico e os dados vinculados não serão alterados.`,
      confirmLabel: 'Confirmar suspensão',
      cancelLabel: 'Voltar',
      tone: 'danger',
      icon: 'alert',
      onConfirm: () => { void performSave(); },
    });
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Suspender usuário"
      sub={user.email}
      icon="alert"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="danger" icon={saving ? 'refresh' : 'alert'} onClick={handleSaveClick}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Suspendendo…' : 'Suspender'}
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

      <FArea label="Motivo da suspensão" placeholder="Descreva o motivo (obrigatório)" value={note} autoFocus
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />

      <div style={{ marginTop: 4, marginBottom: 10, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="alert" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>O acesso à empresa será bloqueado imediatamente. A suspensão pode ser revertida a qualquer momento.</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>O histórico deste usuário é preservado. Nenhum dado é apagado.</span>
      </div>
    </FlowShell>
  );
}
