'use client';
// components/users/EditUserModal.tsx — modal de edição de nome/papel da
// seção "Usuários ativos" (M1-F S5-D, §22.9/§22.12 do design). Dois
// contratos ESTREITOS e independentes (update_profile_name/
// update_membership_role) — nunca uma RPC genérica, nunca payload
// arbitrário. Nome e papel são operações SEPARADAS: nenhuma atomicidade
// fingida entre as duas — cada uma é tentada, o resultado real de cada uma
// é reportado, e a lista é sempre revalidada a partir do servidor (via
// invalidateQueries dentro dos próprios hooks de mutation).
import React, { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FlowShell, Segmented } from '@/components/flows/FlowsShared';
import { useUpdateProfileName, getUpdateProfileNameErrorMessage } from '@/lib/hooks/useUpdateProfileName';
import { useUpdateMembershipRole, getUpdateMembershipRoleErrorMessage } from '@/lib/hooks/useUpdateMembershipRole';
import type { CompanyUserRow } from '@/lib/users/repository';

const ROLE_OPTIONS: [CompanyUserRow['company_role'], string][] = [
  ['seller', 'Vendedor'],
  ['manager', 'Manager'],
];

export type EditUserModalProps = {
  // Ator (quem está editando) — usado só para autorizar as mutations
  // (revalidado de verdade pela RPC) e para a geração de cache.
  userId: string;
  user: CompanyUserRow;
  // Resolvidos pelo chamador (ActiveUserList), a partir da matriz de atores
  // §22.2 — este modal nunca decide capability sozinho.
  canEditName: boolean;
  canEditRole: boolean;
  onClose: () => void;
};

export function EditUserModal({ userId, user, canEditName, canEditRole, onClose }: EditUserModalProps) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<CompanyUserRow['company_role']>(user.company_role);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const { updateProfileName } = useUpdateProfileName({ userId, authorized: canEditName });
  const { updateMembershipRole } = useUpdateMembershipRole({ userId, authorized: canEditRole });

  const nameTrimmed = name.trim();
  const nameChanged = canEditName && nameTrimmed !== user.name;
  const nameInvalid = canEditName && (nameTrimmed === '' || nameTrimmed.length > 120);
  const roleChanged = canEditRole && role !== user.company_role;
  const canSubmit = !saving && !nameInvalid && (nameChanged || roleChanged);

  // Ordem previsível (§22.12): nome primeiro, papel depois. As duas
  // operações são tentadas mesmo que uma falhe — cada RPC é independente,
  // então "fingir" que a segunda nunca roda quando a primeira falha só
  // esconderia informação real do estado do servidor. O que nunca
  // acontece é reportar sucesso total quando só uma das duas funcionou.
  const performSave = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);

    let nameOk: boolean | undefined;
    let nameMessage: string | undefined;
    let roleOk: boolean | undefined;
    let roleMessage: string | undefined;

    if (nameChanged) {
      try {
        await updateProfileName({ targetProfileId: user.profile_id, name: nameTrimmed });
        nameOk = true;
      } catch (err) {
        nameOk = false;
        nameMessage = getUpdateProfileNameErrorMessage(err);
      }
    }

    if (roleChanged) {
      try {
        await updateMembershipRole({ membershipId: user.membership_id, companyId: user.company_id, role });
        roleOk = true;
      } catch (err) {
        roleOk = false;
        roleMessage = getUpdateMembershipRoleErrorMessage(err);
      }
    }

    submittingRef.current = false;
    setSaving(false);

    // Fecha SOMENTE quando tudo que foi tentado deu certo.
    if (nameOk !== false && roleOk !== false) {
      onClose();
      return;
    }

    const parts: string[] = [];
    if (nameChanged) parts.push(nameOk ? 'Nome alterado com sucesso.' : `Nome: ${nameMessage}`);
    if (roleChanged) parts.push(roleOk ? 'Papel alterado com sucesso.' : `Papel: ${roleMessage}`);
    setError(parts.join(' '));
  };

  const handleSaveClick = () => {
    if (!canSubmit || submittingRef.current) return;

    if (roleChanged) {
      (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
        title: role === 'manager' ? 'Promover a Manager?' : 'Rebaixar a Vendedor?',
        message: role === 'manager'
          ? 'O usuário deixará de atuar como Vendedor. O histórico será preservado, mas novas atribuições como Vendedor serão interrompidas.'
          : 'O usuário passará a atuar como Vendedor. O cadastro anterior será reutilizado quando existir. A empresa precisa continuar com outro Manager.',
        confirmLabel: 'Confirmar alteração',
        cancelLabel: 'Voltar',
        tone: 'gold',
        icon: 'refresh',
        onConfirm: () => { void performSave(); },
      });
    } else {
      void performSave();
    }
  };

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Editar usuário"
      sub={user.email}
      icon="user"
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

      {canEditName ? (
        <>
          <FField label="Nome" icon="user" placeholder="Nome completo" value={name} autoFocus
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
          {nameInvalid && (
            <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>
              Informe um nome válido com até 120 caracteres.
            </div>
          )}
        </>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Nome</span>
          <div style={{ fontSize: 15, color: 'var(--t-900)' }}>{user.name}</div>
        </div>
      )}

      {canEditRole && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Papel</span>
          <Segmented options={ROLE_OPTIONS} value={role} onChange={setRole} />
        </div>
      )}
    </FlowShell>
  );
}
