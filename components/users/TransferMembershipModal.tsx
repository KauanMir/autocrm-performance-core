'use client';
// components/users/TransferMembershipModal.tsx — modal de transferência
// empresarial atômica (M1-F S6-F, RPC transfer_membership de S6-D).
// Exclusiva de Super Admin (a UI só oferece esta ação via
// membershipLifecycleCapabilities().canTransfer, que já é false para
// Manager). Empresa de destino vem de useCompanies (mesma fonte que
// ActiveUserList já usa para o filtro de empresa) — nunca um input livre.
// Papel de destino é escolhido explicitamente (nunca herdado do papel de
// origem — a RPC aceita qualquer um dos dois). Sucessor é PROFILE_ID (nunca
// membership_id — contrato distinto de offboard_seller), escolhido entre
// membros ATIVOS da empresa de ORIGEM com o MESMO papel do alvo (nunca da
// empresa de destino) — a própria RPC resolve a membership do sucessor na
// origem a partir desse profile_id.
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FArea, FlowShell, Segmented } from '@/components/flows/FlowsShared';
import { useCompanies } from '@/lib/hooks/useCompanies';
import { useCompanyUsers } from '@/lib/hooks/useCompanyUsers';
import { useTransferMembership, getTransferMembershipErrorMessage } from '@/lib/hooks/useTransferMembership';
import type { Database } from '@/lib/supabase/database.types';
import type { MembershipLifecycleTargetUser } from '@/components/users/membershipLifecycleTypes';

type CompanyRole = Database['public']['Enums']['company_role'];

const ROLE_OPTIONS: [CompanyRole, string][] = [
  ['seller', 'Vendedor'],
  ['manager', 'Manager'],
];

export type TransferMembershipModalProps = {
  userId: string;
  user: MembershipLifecycleTargetUser;
  onClose: () => void;
};

export function TransferMembershipModal({ userId, user, onClose }: TransferMembershipModalProps) {
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [targetRole, setTargetRole] = useState<CompanyRole>(user.company_role);
  const [successorProfileId, setSuccessorProfileId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const companiesQuery = useCompanies({ userId, authorized: true });
  const destinationCompanies = companiesQuery.companies.filter((c) => c.id !== user.company_id);

  // Sucessor: sempre da empresa de ORIGEM, com o MESMO papel do alvo (a RPC
  // recusa qualquer outro via successor_invalid) — nunca da empresa de
  // destino.
  const candidatesQuery = useCompanyUsers({
    userId,
    authorized: true,
    scope: { kind: 'company', companyId: user.company_id },
    role: user.company_role,
    search: null,
  });
  const candidates = candidatesQuery.users.filter((c) => c.profile_id !== user.profile_id);

  const { transferMembership } = useTransferMembership({ userId, authorized: true });

  const trimmedNote = note.trim();
  const canSubmit = !saving && targetCompanyId !== '' && trimmedNote.length >= 3 && trimmedNote.length <= 500;

  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await transferMembership({
        sourceMembershipId: user.membership_id,
        targetCompanyId,
        targetRole,
        successorProfileId: successorProfileId || null,
        note: trimmedNote,
      });
      onClose();
    } catch (err) {
      setError(getTransferMembershipErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;
    const destination = destinationCompanies.find((c) => c.id === targetCompanyId);
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Transferir usuário?',
      message: `${user.name} será desligado de sua empresa atual e vinculado a ${destination?.name ?? 'outra empresa'} como ${targetRole === 'manager' ? 'Manager' : 'Vendedor'}. A conta e o login continuam os mesmos.`,
      confirmLabel: 'Confirmar transferência',
      cancelLabel: 'Voltar',
      tone: 'danger',
      icon: 'refresh',
      onConfirm: () => { void performSave(); },
    });
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Transferir usuário"
      sub={user.email}
      icon="refresh"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="danger" icon={saving ? 'refresh' : 'check'} onClick={handleSaveClick}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Transferindo…' : 'Transferir'}
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
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Empresa de destino</span>
        <select
          aria-label="Selecionar empresa de destino"
          value={targetCompanyId}
          onChange={(e) => setTargetCompanyId(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)' }}
        >
          <option value="">Selecione uma empresa</option>
          {destinationCompanies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Papel no destino</span>
        <Segmented options={ROLE_OPTIONS} value={targetRole} onChange={setTargetRole} />
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Sucessor na empresa de origem (opcional)</span>
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

      <FArea label="Motivo da transferência" placeholder="Descreva o motivo (obrigatório)" value={note}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />

      <div style={{ marginTop: 4, marginBottom: 10, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="alert" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>O vínculo na empresa atual é encerrado (histórico preservado) e um novo vínculo é criado, ou reaproveitado, se já existir um vínculo antigo com esta empresa de destino.</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>A conta e o login deste usuário continuam os mesmos.</span>
      </div>
    </FlowShell>
  );
}
