'use client';
// components/users/InactiveUserList.tsx — listagem de usuários suspensos e
// desligados (M1-F S6-F, §3 do design de retomada). Consome
// list_inactive_company_users (S6-E) via useInactiveCompanyUsers; ações de
// ciclo de vida (Reativar/Desligar/Transferir) delegam aos modais
// dedicados. Renderizado entre ActiveUserList e InviteList na mesma aba
// "Usuários" (ordem: Usuários ativos → Usuários suspensos e desligados →
// Convites), nunca misturado nas outras duas tabelas.
//
// Regras por ator (lib/capabilities.membershipLifecycleCapabilities,
// centralizada — nunca duplicada aqui):
//   Super Admin: suspenso → Reativar/Desligar/Transferir; desligado →
//     somente leitura.
//   Manager: só Sellers da própria empresa; suspenso → Reativar/Desligar;
//     nunca Transferir, nunca outro Manager, nunca fora da empresa.
// company_id/empresa é SEMPRE só filtro visual do Super Admin — nunca
// autorização (mesmo contrato de ActiveUserList).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBadge, LCard, Chip } from '@/components/ui/kit';
import { useInactiveCompanyUsers } from '@/lib/hooks/useInactiveCompanyUsers';
import { useCompanies } from '@/lib/hooks/useCompanies';
import type { InactiveCompanyUserRow } from '@/lib/inactiveUsers/repository';
import type {
  InactiveCompanyUserLifecycleFilter,
  InactiveCompanyUserRoleFilter,
  InactiveCompanyUserScope,
} from '@/lib/inactiveUsers/queryKeys';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import { membershipLifecycleCapabilities, type MembershipLifecycleActor } from '@/lib/capabilities';
import { MembershipLifecycleActions } from '@/components/users/MembershipLifecycleActions';
import { ReactivateMembershipModal } from '@/components/users/ReactivateMembershipModal';
import { OffboardSellerModal } from '@/components/users/OffboardSellerModal';
import { OffboardManagerModal } from '@/components/users/OffboardManagerModal';
import { TransferMembershipModal } from '@/components/users/TransferMembershipModal';

const ROLE_LABEL: Record<InactiveCompanyUserRow['company_role'], string> = {
  manager: 'Manager',
  seller: 'Vendedor',
};

const ROLE_TONE: Record<InactiveCompanyUserRow['company_role'], string> = {
  manager: 'green',
  seller: 'amber',
};

// InactiveCompanyUserRow['lifecycle_status'] herda o enum completo do banco
// (active/suspended/offboarded), mas list_inactive_company_users nunca
// devolve 'active' (rejeitado explicitamente pela RPC, S6-E) — a entrada
// 'active' aqui é só para satisfazer o tipo do enum completo, nunca lida em
// runtime.
const LIFECYCLE_LABEL: Record<InactiveCompanyUserRow['lifecycle_status'], string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  offboarded: 'Desligado',
};

const SEARCH_DEBOUNCE_MS = 300;

type LifecycleAction = 'reactivate' | 'offboard' | 'transfer';

export type InactiveUserListProps = {
  userId: string;
  actor: CreateInviteActor | null;
};

export function InactiveUserList({ userId, actor }: InactiveUserListProps) {
  const isSuperAdmin = actor?.kind === 'super_admin';

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<InactiveCompanyUserRoleFilter>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<InactiveCompanyUserLifecycleFilter>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: LifecycleAction; row: InactiveCompanyUserRow } | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setCompanyFilter(null);
  }, [userId, actor?.kind]);

  const scope: InactiveCompanyUserScope | null = actor === null
    ? null
    : actor.kind === 'super_admin'
      ? { kind: 'platform', companyId: companyFilter }
      : { kind: 'company', companyId: actor.companyId };

  const lifecycleActor: MembershipLifecycleActor | null = actor === null
    ? null
    : actor.kind === 'super_admin'
      ? { kind: 'super_admin', profileId: userId }
      : { kind: 'manager', profileId: userId, companyId: actor.companyId };

  const usersQuery = useInactiveCompanyUsers({
    userId,
    authorized: actor !== null,
    scope,
    role: roleFilter,
    lifecycle: lifecycleFilter,
    search: debouncedSearch || null,
  });

  const companiesQuery = useCompanies({ userId, authorized: isSuperAdmin });

  if (actor === null) return null;

  const hasActiveFilters = debouncedSearch !== '' || roleFilter !== null || lifecycleFilter !== null || companyFilter !== null;

  const openAction = (kind: LifecycleAction, row: InactiveCompanyUserRow, trigger: HTMLElement | null) => {
    lastFocusedRef.current = trigger;
    setAction({ kind, row });
  };

  const closeAction = () => {
    setAction(null);
    lastFocusedRef.current?.focus();
  };

  return (
    <>
      <LCard pad={0} style={{ overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Usuários suspensos e desligados</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
              <Icon name="search" size={15} stroke={2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t-400)' }} />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                aria-label="Buscar usuário inativo por nome ou e-mail"
                style={{ width: '100%', padding: '8px 30px 8px 34px', borderRadius: 9, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)', outline: 'none' }}
              />
              {searchInput !== '' && (
                <button type="button" onClick={() => setSearchInput('')} aria-label="Limpar busca"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t-400)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="x" size={14} stroke={2.2} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Filtrar por status">
              <Chip active={lifecycleFilter === null} onClick={() => setLifecycleFilter(null)}>Todos</Chip>
              <Chip active={lifecycleFilter === 'suspended'} onClick={() => setLifecycleFilter('suspended')}>Suspensos</Chip>
              <Chip active={lifecycleFilter === 'offboarded'} onClick={() => setLifecycleFilter('offboarded')}>Desligados</Chip>
            </div>
            <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Filtrar por papel">
              <Chip active={roleFilter === null} onClick={() => setRoleFilter(null)}>Todos os papéis</Chip>
              <Chip active={roleFilter === 'manager'} onClick={() => setRoleFilter('manager')}>Managers</Chip>
              <Chip active={roleFilter === 'seller'} onClick={() => setRoleFilter('seller')}>Sellers</Chip>
            </div>
            {isSuperAdmin && (
              <InactiveCompanyFilter
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
            <button type="button" onClick={() => usersQuery.refetch()} style={{ border: 'none', background: 'transparent', color: 'var(--t-500)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, textDecoration: 'underline' }}>
              Tentar novamente
            </button>
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.isEmpty && (
          <div style={{ padding: '32px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--t-500)' }}>
            <Icon name="users" size={24} stroke={2} />
            <span style={{ fontSize: 13.5 }}>
              {hasActiveFilters ? 'Nenhum usuário encontrado para os filtros atuais.' : 'Nenhum usuário suspenso ou desligado.'}
            </span>
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.hasData && (
          <div>
            {usersQuery.users.map((row) => (
              <InactiveUserRow
                key={row.membership_id}
                row={row}
                userId={userId}
                isSuperAdmin={isSuperAdmin}
                lifecycleActor={lifecycleActor}
                onAction={(kind, trigger) => openAction(kind, row, trigger)}
              />
            ))}
          </div>
        )}

        {!usersQuery.isLoading && !usersQuery.isError && usersQuery.hasData && (
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border-2)' }}>
            {usersQuery.hasMore ? (
              <button
                type="button"
                onClick={() => { if (!usersQuery.isFetchingNextPage) usersQuery.fetchNextPage(); }}
                style={{ border: 'none', background: 'transparent', color: 'var(--t-500)', cursor: usersQuery.isFetchingNextPage ? 'wait' : 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: usersQuery.isFetchingNextPage ? 0.6 : 1 }}
              >
                {usersQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </button>
            ) : (
              <span data-testid="inactive-users-end" style={{ fontSize: 12, color: 'var(--t-400)' }}>Fim da lista.</span>
            )}
          </div>
        )}
      </LCard>

      {action?.kind === 'reactivate' && (
        <ReactivateMembershipModal userId={userId} user={action.row} onClose={closeAction} />
      )}
      {action?.kind === 'offboard' && action.row.company_role === 'seller' && (
        <OffboardSellerModal userId={userId} user={action.row} onClose={closeAction} />
      )}
      {action?.kind === 'offboard' && action.row.company_role === 'manager' && (
        <OffboardManagerModal userId={userId} user={action.row} onClose={closeAction} />
      )}
      {action?.kind === 'transfer' && (
        <TransferMembershipModal userId={userId} user={action.row} onClose={closeAction} />
      )}
    </>
  );
}

function InactiveUserRow({ row, userId, isSuperAdmin, lifecycleActor, onAction }: {
  row: InactiveCompanyUserRow;
  userId: string;
  isSuperAdmin: boolean;
  lifecycleActor: MembershipLifecycleActor | null;
  onAction: (kind: LifecycleAction, trigger: HTMLElement | null) => void;
}) {
  const capabilities = membershipLifecycleCapabilities(
    {
      profileId: row.profile_id,
      companyId: row.company_id,
      companyRole: row.company_role,
      lifecycleStatus: row.lifecycle_status,
    },
    lifecycleActor,
  );
  const isReadOnly = !capabilities.canSuspend && !capabilities.canReactivate && !capabilities.canOffboard && !capabilities.canTransfer;

  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
          <div style={{ fontSize: 12, color: 'var(--t-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</div>
        </div>
        <LBadge tone={ROLE_TONE[row.company_role]} style={{ flexShrink: 0 }}>{ROLE_LABEL[row.company_role]}</LBadge>
        <LBadge tone={row.lifecycle_status === 'suspended' ? 'amber' : 'red'} style={{ flexShrink: 0 }}>
          {LIFECYCLE_LABEL[row.lifecycle_status]}
        </LBadge>
        {isSuperAdmin && (
          <span style={{ fontSize: 12.5, color: 'var(--t-500)', flexShrink: 0, minWidth: 110, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.company_name}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          {isReadOnly ? (
            <span style={{ fontSize: 12, color: 'var(--t-400)' }}>Somente leitura</span>
          ) : (
            <MembershipLifecycleActions
              capabilities={capabilities}
              onSuspend={() => {}}
              onReactivate={(trigger) => onAction('reactivate', trigger)}
              onOffboard={(trigger) => onAction('offboard', trigger)}
              onTransfer={(trigger) => onAction('transfer', trigger)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function InactiveCompanyFilter({ companyId, onPick, companies, isLoading }: {
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
