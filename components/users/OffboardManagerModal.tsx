'use client';
// components/users/OffboardManagerModal.tsx — modal de desligamento de
// Manager (M1-F S6-F, RPC offboard_manager de S6-C). Seletor de sucessor
// REUTILIZA list_company_users (via useCompanyUsers) filtrado por
// company_role='manager' e pela empresa de ORIGEM — mas o valor enviado é
// profile_id (p_successor_profile_id), NUNCA membership_id: contrato
// diferente de offboard_seller, confirmado na migration/database.types.ts
// antes de escrever este arquivo. O sucessor precisa JÁ ser Manager ativo —
// esta RPC nunca promove ninguém implicitamente, por isso o seletor só lista
// quem já tem company_role='manager'. last_manager_requires_successor é
// tratado como erro de domínio comum (mantém o modal aberto, nunca fecha).
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FArea, FlowShell } from '@/components/flows/FlowsShared';
import { useCompanyUsers } from '@/lib/hooks/useCompanyUsers';
import { useOffboardManager, getOffboardManagerErrorMessage } from '@/lib/hooks/useOffboardManager';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

export type OffboardManagerModalProps = {
  userId: string;
  user: MembershipLifecycleTargetUser;
  onClose: () => void;
};

export function OffboardManagerModal({ userId, user, onClose }: OffboardManagerModalProps) {
  const [note, setNote] = useState('');
  const [successorProfileId, setSuccessorProfileId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const candidatesQuery = useCompanyUsers({
    userId,
    authorized: true,
    scope: { kind: 'company', companyId: user.company_id },
    role: 'manager',
    search: null,
  });
  const candidates = candidatesQuery.users.filter((c) => c.profile_id !== user.profile_id);

  const { offboardManager } = useOffboardManager({ userId, authorized: true });

  const trimmedNote = note.trim();
  const canSubmit = !saving && trimmedNote.length >= 3 && trimmedNote.length <= 500;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await offboardManager({
        managerMembershipId: user.membership_id,
        successorProfileId: successorProfileId || null,
        note: trimmedNote,
      });
      onClose();
    } catch (err) {
      setError(getOffboardManagerErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Desligar Manager?',
      message: `${user.name} será desligado. Nenhum outro usuário é promovido automaticamente.`,
      confirmLabel: 'Confirmar desligamento',
      cancelLabel: 'Voltar',
      tone: 'danger',
      icon: 'alert',
      onConfirm: () => { void performSave(); },
    });
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Desligar Manager"
      sub={user.email}
      icon="alert"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="danger" icon={saving ? 'refresh' : 'alert'} onClick={handleSaveClick}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Desligando…' : 'Desligar'}
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

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Sucessor (Manager já ativo, opcional)</span>
        <select
          aria-label="Selecionar sucessor"
          value={successorProfileId}
          onChange={(e) => setSuccessorProfileId(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)' }}
        >
          <option value="">Nenhum sucessor</option>
          {candidates.map((c) => (
            <option key={c.profile_id} value={c.profile_id}>{c.name} ({c.email})</option>
          ))}
        </select>
      </label>

      <FArea label="Motivo do desligamento" placeholder="Descreva o motivo (obrigatório)" value={note}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />

      <div style={{ marginTop: 4, marginBottom: 10, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="alert" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>A empresa precisa manter ao menos um Manager ativo. Se este for o último, selecione um sucessor que já seja Manager ativo antes de continuar.</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>O sucessor selecionado precisa já ser Manager ativo. Ninguém é promovido automaticamente.</span>
      </div>
    </FlowShell>
  );
}
