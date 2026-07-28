'use client';
// components/users/ReactivateMembershipModal.tsx — modal de reativação
// empresarial (M1-F S6-F, RPC reactivate_membership de S6-B). Só se aplica a
// membership suspensa (a UI só oferece esta ação nesse estado, ver
// InactiveUserList/membershipLifecycleCapabilities). Motivo OPCIONAL —
// diferente de SuspendMembershipModal.
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FArea, FlowShell } from '@/components/flows/FlowsShared';
import { useReactivateMembership, getReactivateMembershipErrorMessage } from '@/lib/hooks/useReactivateMembership';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

export type ReactivateMembershipModalProps = {
  userId: string;
  user: MembershipLifecycleTargetUser;
  onClose: () => void;
};

export function ReactivateMembershipModal({ userId, user, onClose }: ReactivateMembershipModalProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const { reactivateMembership } = useReactivateMembership({ userId, authorized: true });

  const canSubmit = !saving;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await reactivateMembership({ membershipId: user.membership_id, note: note.trim() || null });
      onClose();
    } catch (err) {
      setError(getReactivateMembershipErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Reativar usuário?',
      message: `${user.name} voltará a ter acesso à empresa.`,
      confirmLabel: 'Confirmar reativação',
      cancelLabel: 'Voltar',
      tone: 'gold',
      icon: 'refresh',
      onConfirm: () => { void performSave(); },
    });
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Reativar usuário"
      sub={user.email}
      icon="refresh"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={saving ? 'refresh' : 'check'} onClick={handleSaveClick}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Reativando…' : 'Reativar'}
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

      <FArea label="Motivo (opcional)" placeholder="Descreva o motivo, se desejar" value={note} autoFocus
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />

      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>O acesso à empresa será restaurado imediatamente.</span>
      </div>
    </FlowShell>
  );
}
