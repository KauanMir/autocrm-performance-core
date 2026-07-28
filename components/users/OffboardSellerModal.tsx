'use client';
// components/users/OffboardSellerModal.tsx — modal de desligamento de Seller
// (M1-F S6-F, RPC offboard_seller endurecida em S6-E2). Seletor de sucessor
// REUTILIZA list_company_users (via useCompanyUsers) filtrado por
// company_role='seller' e pela empresa de ORIGEM, com memberships ativas
// apenas (contrato do próprio list_company_users) — nunca cria
// list_company_sellers, nunca SELECT direto em sellers, nunca expõe
// seller_id (o valor enviado é sempre membership_id). successor_required
// (código novo do S6-E2) é um erro de domínio comum — o modal NUNCA fecha
// sozinho em erro, então a mensagem ("selecione outro Vendedor") já mantém o
// fluxo aberto pedindo a escolha, sem tratamento especial adicional.
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FArea, FlowShell } from '@/components/flows/FlowsShared';
import { useCompanyUsers } from '@/lib/hooks/useCompanyUsers';
import { useOffboardSeller, getOffboardSellerErrorMessage } from '@/lib/hooks/useOffboardSeller';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

export type OffboardSellerModalProps = {
  userId: string;
  user: MembershipLifecycleTargetUser;
  onClose: () => void;
};

export function OffboardSellerModal({ userId, user, onClose }: OffboardSellerModalProps) {
  const [note, setNote] = useState('');
  const [successorMembershipId, setSuccessorMembershipId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  // Fonte segura do sucessor: mesma RPC/hook que já alimenta "Usuários
  // ativos" — nenhuma listagem nova, nenhum acesso direto a sellers.
  const candidatesQuery = useCompanyUsers({
    userId,
    authorized: true,
    scope: { kind: 'company', companyId: user.company_id },
    role: 'seller',
    search: null,
  });
  const candidates = candidatesQuery.users.filter((c) => c.membership_id !== user.membership_id);

  const { offboardSeller } = useOffboardSeller({ userId, authorized: true });

  const trimmedNote = note.trim();
  const canSubmit = !saving && trimmedNote.length >= 3 && trimmedNote.length <= 500;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await offboardSeller({
        sellerMembershipId: user.membership_id,
        successorMembershipId: successorMembershipId || null,
        note: trimmedNote,
      });
      onClose();
    } catch (err) {
      setError(getOffboardSellerErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Desligar vendedor?',
      message: successorMembershipId
        ? `${user.name} será desligado. Os leads em aberto serão repassados ao sucessor selecionado. Leads já arquivados continuam vinculados ao histórico de ${user.name}.`
        : `${user.name} será desligado. Leads já arquivados continuam vinculados ao histórico de ${user.name}.`,
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
      title="Desligar vendedor"
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
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Sucessor (opcional)</span>
        <select
          aria-label="Selecionar sucessor"
          value={successorMembershipId}
          onChange={(e) => setSuccessorMembershipId(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)' }}
        >
          <option value="">Nenhum sucessor</option>
          {candidates.map((c) => (
            <option key={c.membership_id} value={c.membership_id}>{c.name} — {c.email}</option>
          ))}
        </select>
      </label>

      <FArea label="Motivo do desligamento" placeholder="Descreva o motivo (obrigatório)" value={note}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />

      <div style={{ marginTop: 4, marginBottom: 10, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="alert" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Leads em aberto serão repassados ao sucessor selecionado. Sem sucessor, o desligamento só é permitido quando não há leads em aberto.</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Leads arquivados nunca são alterados — permanecem vinculados ao histórico deste vendedor.</span>
      </div>
    </FlowShell>
  );
}
