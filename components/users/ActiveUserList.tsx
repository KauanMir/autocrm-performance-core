'use client';
// components/users/ActiveUserList.tsx — listagem real de usuários ativos
// (M1-F S5-D, §22.9 do design). Consome list_company_users (S5-A2) via
// useCompanyUsers; edição de nome/papel delega inteiramente a
// EditUserModal (update_profile_name/update_membership_role, S5-B/S5-C).
// Renderizado ACIMA de InviteList na mesma aba "Usuários", nunca misturado
// na mesma tabela — nenhuma alteração no contrato de convites.
//
// Regras por ator (§22.2) — decididas aqui, nunca no modal:
//   Super Admin: vê Managers e Sellers de qualquer empresa; edita nome de
//     qualquer um; edita papel de qualquer um QUE NÃO seja o próprio ator
//     (self_role_change_forbidden é reforçado aqui também, em profundidade —
//     a RPC já recusaria, mas a UI nem oferece o botão).
//   Manager: vê Sellers (edita nome) e Managers da própria empresa (SOMENTE
//     LEITURA — nunca edita outro Manager, nunca altera papel).
// company_id/empresa é SEMPRE só filtro visual do Super Admin — nunca
// autorização (nenhum uso de selectedCompanyId aqui; o filtro é estado local
// deste componente, nunca persistido, nunca decide o que o servidor aceita).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard, Chip } from '@/components/ui/kit';
import { useCompanyUsers } from '@/lib/hooks/useCompanyUsers';
import type { CompanyUserRow } from '@/lib/users/repository';
import type { CompanyUserRoleFilter, CompanyUserScope } from '@/lib/users/queryKeys';
import { useCompanies } from '@/lib/hooks/useCompanies';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import { EditUserModal } from '@/components/users/EditUserModal';

const ROLE_LABEL: Record<CompanyUserRow['company_role'], string> = {
  manager: 'Manager',
  seller: 'Vendedor',
};

const ROLE_TONE: Record<CompanyUserRow['company_role'], string> = {
  manager: 'green',
  seller: 'amber',
};

const SEARCH_DEBOUNCE_MS = 300;

type RowCapabilities = {
  canEditName: boolean;
  canEditRole: boolean;
  readOnly: boolean;
};

// Única fonte de decisão de capability por linha — nunca duplicada no
// modal. Manager nunca chega a canEditRole=true (troca de papel é
// exclusiva de Super Admin, §22.2); Super Admin nunca edita o próprio
// papel (self_role_change_forbidden reforçado em profundidade).
function rowCapabilities(row: CompanyUserRow, actorProfileId: string, isSuperAdmin: boolean): RowCapabilities {
  const isSelf = row.profile_id === actorProfileId;
  if (isSuperAdmin) {
    return { canEditName: true, canEditRole: !isSelf, readOnly: false };
  }
  const isSeller = row.company_role === 'seller';
  return { canEditName: isSeller, canEditRole: false, readOnly: !isSeller };
}

export type ActiveUserListProps = {
  userId: string;
  // null: ator sem capability de gerenciar usuários — não renderiza nada
  // (defesa em profundidade; ScreenAjustes já não chega a montar este
  // componente nesse caso). Mesmo tipo de InviteList/InviteUserModal —
  // super_admin (escopo global) ou manager (escopo da própria empresa).
  actor: CreateInviteActor | null;
};

export function ActiveUserList({ userId, actor }: ActiveUserListProps) {
  const isSuperAdmin = actor?.kind === 'super_admin';

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<CompanyUserRoleFilter>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<CompanyUserRow | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Troca de identidade/ator nunca herda o filtro de empresa de uma sessão
  // anterior (só existe para Super Admin, e é sempre estado local nunca
  // persistido — nada de localStorage/selectedCompanyId).
  useEffect(() => {
    setCompanyFilter(null);
  }, [userId, actor?.kind]);

  const scope: CompanyUserScope | null = actor === null
    ? null
    : actor.kind === 'super_admin'
      ? { kind: 'platform', companyId: companyFilter }
      : { kind: 'company', companyId: actor.companyId };

  const usersQuery = useCompanyUsers({
    userId,
    authorized: actor !== null,
    scope,
    role: roleFilter,
    search: debouncedSearch || null,
  });

  // Só para popular o filtro de empresa do Super Admin — nunca autorização
  // (RLS/can_access_company decide o que volta). Manager nunca busca isso.
  const companiesQuery = useCompanies({ userId, authorized: isSuperAdmin });

  if (actor === null) return null;

  const hasActiveFilters = debouncedSearch !== '' || roleFilter !== null || companyFilter !== null;

  const openEdit = (row: CompanyUserRow, trigger: HTMLElement | null) => {
    lastFocusedRef.current = trigger;
    setEditing(row);
  };

  const closeEdit = () => {
    setEditing(null);
    lastFocusedRef.current?.focus();
  };

  return (
    <>
      <LCard pad={0} style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Usuários ativos</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
              <Icon name="search" size={15} stroke={2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t-400)' }} />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                aria-label="Buscar usuário por nome ou e-mail"
                style={{ width: '100%', padding: '8px 30px 8px 34px', borderRadius: 9, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)', outline: 'none' }}
              />
              {searchInput !== '' && (
                <button type="button" onClick={() => setSearchInput('')} aria-label="Limpar busca"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t-400)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="x" size={14} stroke={2.2} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Filtrar por papel">
              <Chip active={roleFilter === null} onClick={() => setRoleFilter(null)}>Todos</Chip>
              <Chip active={roleFilter === 'manager'} onClick={() => setRoleFilter('manager')}>Managers</Chip>
              <Chip active={roleFilter === 'seller'} onClick={() => setRoleFilter('seller')}>Sellers</Chip>
            </div>
            {isSuperAdmin && (
              <CompanyFilter
                companyId={companyFilter}
                onPick={setCompanyFilter}
                companies={companiesQuery.companies}
                isLoading={companiesQuery.isLoading}
              />
            )}
          </div>
        </div>

        {usersQuery.isLoading && (
          <div aria-live="polite" style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--t-400)', fontSize: 13.5 }}>
            Carregando usuários…
          </div>
        )}

        {!usersQuery.isLoading && usersQuery.isError && (
          <div style={{ padding: '32px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--t-500)' }}>
            <Icon name="wifiOff" size={24} stroke={2} />
            <span style={{ fontSize: 13.5 }}>Não foi possível carregar os usuários.</span>
            <LBtn kind="ghost" size="sm" icon="refresh" onClick={() => usersQuery.refetch()}>Tentar novamente</LBtn>
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.isEmpty && (
          <div style={{ padding: '32px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--t-500)' }}>
            <Icon name="users" size={24} stroke={2} />
            <span style={{ fontSize: 13.5 }}>
              {hasActiveFilters ? 'Nenhum usuário encontrado para os filtros atuais.' : 'Nenhum usuário ativo ainda.'}
            </span>
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.hasData && (
          <div>
            {usersQuery.users.map((row) => (
              <UserRow
                key={row.membership_id}
                row={row}
                userId={userId}
                isSuperAdmin={isSuperAdmin}
                onEdit={(trigger) => openEdit(row, trigger)}
              />
            ))}
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.hasData && (
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border-2)' }}>
            {usersQuery.hasMore ? (
              <LBtn
                kind="ghost"
                size="sm"
                icon="refresh"
                onClick={() => { if (!usersQuery.isFetchingNextPage) usersQuery.fetchNextPage(); }}
                style={{ opacity: usersQuery.isFetchingNextPage ? 0.6 : 1, cursor: usersQuery.isFetchingNextPage ? 'wait' : 'pointer' }}
              >
                {usersQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </LBtn>
            ) : (
              <span data-testid="active-users-end" style={{ fontSize: 12, color: 'var(--t-400)' }}>Fim da lista.</span>
            )}
          </div>
        )}
      </LCard>

      {editing && (
        <EditUserModal
          userId={userId}
          user={editing}
          canEditName={rowCapabilities(editing, userId, isSuperAdmin).canEditName}
          canEditRole={rowCapabilities(editing, userId, isSuperAdmin).canEditRole}
          onClose={closeEdit}
        />
      )}
    </>
  );
}

function UserRow({ row, userId, isSuperAdmin, onEdit }: {
  row: CompanyUserRow;
  userId: string;
  isSuperAdmin: boolean;
  onEdit: (trigger: HTMLElement | null) => void;
}) {
  const caps = rowCapabilities(row, userId, isSuperAdmin);
  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
          <div style={{ fontSize: 12, color: 'var(--t-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</div>
        </div>
        <LBadge tone={ROLE_TONE[row.company_role]} style={{ flexShrink: 0 }}>{ROLE_LABEL[row.company_role]}</LBadge>
        {isSuperAdmin && (
          <span style={{ fontSize: 12.5, color: 'var(--t-500)', flexShrink: 0, minWidth: 110, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.company_name}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          {caps.readOnly ? (
            <span style={{ fontSize: 12, color: 'var(--t-400)' }}>Somente leitura</span>
          ) : (
            <LBtn size="sm" kind="ghost" icon="edit" aria-label={`Editar ${row.name}`}
              onClick={() => onEdit(document.activeElement as HTMLElement | null)}>
              Editar
            </LBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function CompanyFilter({ companyId, onPick, companies, isLoading }: {
  companyId: string | null;
  onPick: (id: string | null) => void;
  companies: readonly PlatformCompanyRow[];
  isLoading: boolean;
}) {
  const [show, setShow] = useState(false);
  const selected = companies.find((c) => c.id === companyId) ?? null;
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setShow((s) => !s)} disabled={isLoading} aria-label="Filtrar por empresa"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', fontFamily: 'inherit', fontSize: 13, color: 'var(--t-900)', cursor: isLoading ? 'wait' : 'pointer' }}>
        <Icon name="building" size={14} stroke={2} style={{ color: 'var(--t-400)' }} />
        <span>{isLoading ? 'Carregando…' : selected ? selected.name : 'Todas as empresas'}</span>
        <Icon name="arrowDown" size={13} stroke={2} style={{ color: 'var(--t-400)', transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {show && !isLoading && (
        <div style={{ position: 'absolute', left: 0, top: 40, zIndex: 5, minWidth: 220, maxHeight: 240, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
          <button type="button" onClick={() => { onPick(null); setShow(false); }}
            style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontSize: 13.5 }}>
            Todas as empresas
          </button>
          {companies.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c.id); setShow(false); }}
              style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontSize: 13.5 }}>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
